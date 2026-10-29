import Foundation
import Security

// Installed once at a versioned, stable path. Updating 1top does not replace
// this executable and therefore does not invalidate its own Keychain ACL.
let args = Array(CommandLine.arguments.dropFirst())
func finish(_ value: [String: Any], _ code: Int32 = 0) -> Never {
    if let data = try? JSONSerialization.data(withJSONObject: value) { FileHandle.standardOutput.write(data) }
    exit(code)
}
guard args.count >= 3 else { finish(["error":"invalid_arguments"], 2) }
let action = args[0], source = args[1], owner = args[2]
guard source.hasPrefix("Claude Code-credentials"), ["get", "set", "authorize"].contains(action) else {
    finish(["error":"invalid_arguments"], 2)
}
guard SecKeychainSetUserInteractionAllowed(false) == errSecSuccess else {
    finish(["error":"credential_store_unavailable"], 1)
}
let target: [String: Any] = [kSecClass as String:kSecClassGenericPassword,
    kSecAttrService as String:"si.1top.claude.credentials.v1",
    kSecAttrAccount as String:source + "|" + owner,
    kSecUseAuthenticationUI as String:kSecUseAuthenticationUIFail]
func read(_ query: [String: Any]) -> (OSStatus, Data?) {
    var q = query; q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(q as CFDictionary, &result)
    return (status, result as? Data)
}
let (existingStatus, existing) = read(target)
if action == "get" {
    if existingStatus == errSecItemNotFound { finish(["missing":true]) }
    guard existingStatus == errSecSuccess, let existing else { finish(["error":"credential_store_unavailable"], 1) }
    FileHandle.standardOutput.write(existing); exit(0)
}
if action == "authorize", existingStatus == errSecSuccess {
    guard args.count == 4, let existing,
          let obj = try? JSONSerialization.jsonObject(with:existing) as? [String:Any],
          obj["account_id"] as? String == args[3] else { finish(["error":"account_changed"], 1) }
    finish(["ok":true,"already_connected":true])
}
var data: Data
if action == "authorize" {
    guard args.count == 4, args[3].hasPrefix("claude:") else { finish(["error":"invalid_arguments"], 2) }
    // This is the ONLY interactive Keychain operation. One explicit command,
    // one existing account item, no retry, and no ACL relaxation.
    guard SecKeychainSetUserInteractionAllowed(true) == errSecSuccess else {
        finish(["error":"credential_store_unavailable"], 1)
    }
    let (status, value) = read([kSecClass as String:kSecClassGenericPassword,
        kSecAttrService as String:source,kSecAttrAccount as String:owner,
        kSecUseAuthenticationUI as String:kSecUseAuthenticationUIAllow,
        kSecUseOperationPrompt as String:"1top: connect this Claude account once"])
    guard SecKeychainSetUserInteractionAllowed(false) == errSecSuccess else {
        finish(["error":"credential_store_unavailable"], 1)
    }
    guard status == errSecSuccess, let value, value.count <= 128*1024,
          let doc = try? JSONSerialization.jsonObject(with:value) as? [String:Any],
          let oauth = doc["claudeAiOauth"] as? [String:Any], oauth["accessToken"] is String else {
        finish(["error":"authorization_not_completed","os_status":status], 1)
    }
    data = try! JSONSerialization.data(withJSONObject:["schema":1,"account_id":args[3],"document":doc])
} else {
    data = FileHandle.standardInput.readDataToEndOfFile()
    guard data.count <= 128*1024,
          let obj = try? JSONSerialization.jsonObject(with:data) as? [String:Any],
          obj["account_id"] is String, obj["document"] is [String:Any] else {
        finish(["error":"invalid_document"], 2)
    }
}
let status: OSStatus
if existingStatus == errSecSuccess {
    status = SecItemUpdate(target as CFDictionary,[kSecValueData as String:data] as CFDictionary)
} else if existingStatus == errSecItemNotFound {
    var q = target; q[kSecValueData as String] = data
    q[kSecAttrLabel as String] = "1top Claude account"
    status = SecItemAdd(q as CFDictionary,nil)
} else { finish(["error":"credential_store_unavailable"], 1) }
guard status == errSecSuccess else { finish(["error":"credential_store_unavailable","os_status":status], 1) }
finish(["ok":true])
