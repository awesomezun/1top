import UIKit
import XCTest
@testable import OneTop

/// Back-to-back sends from the phone: nothing written in the meantime is overwritten or lost, only
/// the sending session's draft is touched, late receipts never undo a reply, and mailbox answers
/// merge into the timeline.
@MainActor
final class SendTests: XCTestCase {
    private var model: AppModel!
    private var session: Session!
    private var other: Session!
    private var calls = 0

    override func setUp() async throws {
        let model = AppModel()
        model.useTestToken("1tm_" + String(repeating: "a", count: 64))
        let caps = ["message", "mailbox", "message_images"]
        let now = Date().timeIntervalSince1970
        let snapshot = DeviceSnapshot(sessions: [Session(id: "s1", controlKey: "k1", kind: "Claude", status: "working", capabilities: caps),
                                                 Session(id: "s2", controlKey: "k2", kind: "Codex", status: "working", capabilities: caps)])
        model.devices = [Device(id: "dev-1", name: "Mac", platform: "macOS", online: true, received: now * 1000, snapshot: snapshot)]
        model.connection = .live
        self.model = model
        session = model.allSessions.first { $0.id == "s1" }
        other = model.allSessions.first { $0.id == "s2" }
        calls = 0
    }

    private func respond(after milliseconds: Int, _ outcome: Result<String, Error>) {
        model.transport = { [weak self] _, _, _ in
            self?.calls += 1
            try await Task.sleep(for: .milliseconds(milliseconds))
            return Data(try outcome.get().utf8)
        }
    }

    private func photo() throws -> PickedPhoto {
        let image = UIGraphicsImageRenderer(size: CGSize(width: 40, height: 30)).image { ctx in
            UIColor.orange.setFill(); ctx.fill(CGRect(x: 0, y: 0, width: 40, height: 30))
        }
        return try PhotoPrep.prepare(XCTUnwrap(image.pngData()))
    }

    /// Starts a send of `text`, then writes `next` while it is on its way.
    private func send(_ text: String, thenWrite next: String?) async {
        model.drafts[session.key] = Draft(text: text)
        let sending = Task { await model.sendConversation(session) }
        try? await Task.sleep(for: .milliseconds(60))
        XCTAssertTrue(model.drafts[session.key]?.isEmpty ?? true, "Composer not emptied when the send started")
        if let next { model.drafts[session.key] = Draft(text: next) }
        await sending.value
    }

    func testNewDraftKeptWhenSendSucceeds() async {
        respond(after: 300, .success(#"{"status":"sent"}"#))
        await send("A", thenWrite: "B")
        XCTAssertEqual(model.drafts[session.key]?.text, "B")
        XCTAssertEqual(model.mailboxes[session.key]?.messages.last?.text, "A")
        XCTAssertEqual(model.mailboxes[session.key]?.messages.last?.status, "awaiting_reply")
    }

    func testRefusedSendDoesNotOverwriteNewDraft() async throws {
        respond(after: 300, .failure(Relay.Failure(status: 400, message: "Refused")))
        model.drafts[session.key] = Draft(text: "A", photos: [try photo(), try photo()])
        let sending = Task { await model.sendConversation(session) }
        try? await Task.sleep(for: .milliseconds(60))
        model.drafts[session.key] = Draft(text: "B", photos: [try photo(), try photo()])
        await sending.value
        XCTAssertEqual(model.drafts[session.key]?.text, "B", "The new draft was overwritten")
        let failed = try XCTUnwrap(model.mailboxes[session.key]?.messages.last)
        XCTAssertEqual(failed.status, "send_failed")
        XCTAssertEqual(failed.text, "A")
        XCTAssertEqual(model.sentPhotos[failed.id]?.count, 2, "The refused photos are not shown")
        model.bringBack(failed.id, key: session.key)
        XCTAssertEqual(model.drafts[session.key]?.text, "B\nA")
        XCTAssertEqual(model.drafts[session.key]?.photos.count, PhotoPrep.maxPhotos, "Photos not merged up to three")
        XCTAssertFalse(model.mailboxes[session.key]?.messages.contains { $0.id == failed.id } ?? true)
    }

    func testRefusedSendComesBackIntoAnEmptyComposer() async {
        respond(after: 100, .failure(Relay.Failure(status: 409, message: "Refused")))
        await send("A", thenWrite: nil)
        XCTAssertEqual(model.drafts[session.key]?.text, "A")
        XCTAssertEqual(model.drafts[session.key]?.error, "Refused")
        XCTAssertTrue(model.mailboxes[session.key]?.messages.isEmpty ?? true)
    }

    func testOtherSessionsDraftIsNeverTouched() async {
        model.drafts[other.key] = Draft(text: "Z")
        respond(after: 100, .failure(Relay.Failure(status: 400, message: "Refused")))
        await send("A", thenWrite: nil)
        respond(after: 100, .success(#"{"status":"sent"}"#))
        await send("A2", thenWrite: "B")
        XCTAssertEqual(model.drafts[other.key]?.text, "Z")
        XCTAssertNil(model.mailboxes[other.key])
    }

    func testBackToBackSendsAllArrive() async {
        respond(after: 300, .success(#"{"status":"sent"}"#))
        var tasks: [Task<Void, Never>] = []
        for text in ["one", "two", "three"] {
            model.drafts[session.key] = Draft(text: text)
            tasks.append(Task { await model.sendConversation(session) })
            try? await Task.sleep(for: .milliseconds(40))
        }
        for task in tasks { await task.value }
        let rows = model.mailboxes[session.key]?.messages ?? []
        XCTAssertEqual(rows.map(\.text), ["one", "two", "three"])
        XCTAssertEqual(Set(rows.map(\.id)).count, 3)
        XCTAssertTrue(rows.allSatisfy { $0.status == "awaiting_reply" })
        XCTAssertEqual(calls, 3)
    }

    func testTimeOutIsUnconfirmedAndNeverResent() async {
        respond(after: 100, .failure(URLError(.timedOut)))
        await send("A", thenWrite: "B")
        XCTAssertEqual(calls, 1)
        XCTAssertEqual(model.mailboxes[session.key]?.messages.last?.status, "delivery_unconfirmed")
        XCTAssertEqual(model.drafts[session.key]?.text, "B")
    }

    func testLateReceiptDoesNotUndoAReply() {
        let id = "00000000-0000-4000-8000-000000000042"
        model.mailboxes[session.key] = .init(messages: [MailMessage(id: id, text: "q", created: 1, status: "replied", reply: "done")])
        let request = ActionRequest(action: "message", requestId: id, deviceId: "dev-1", sessionId: "s1")
        model.apply(LiveMessage(type: "result", request: request, status: "completed"))
        XCTAssertEqual(model.mailboxes[session.key]?.messages.first?.status, "replied")
        model.apply(LiveMessage(type: "result", request: request, status: "failed", message: "late"))
        XCTAssertEqual(model.mailboxes[session.key]?.messages.first?.status, "replied")
        XCTAssertEqual(model.mailboxes[session.key]?.messages.first?.reply, "done")
    }

    func testReceiptMovesASendForwardAndReportsAFailure() {
        let id = "00000000-0000-4000-8000-000000000043"
        model.mailboxes[session.key] = .init(messages: [MailMessage(id: id, text: "q", created: 1, status: "sending")])
        let request = ActionRequest(action: "message", requestId: id, deviceId: "dev-1", sessionId: "s1")
        model.apply(LiveMessage(type: "result", request: request, status: "completed"))
        XCTAssertEqual(model.mailboxes[session.key]?.messages.first?.status, "awaiting_reply")
        model.apply(LiveMessage(type: "result", request: request, status: "failed", message: "not delivered"))
        XCTAssertEqual(model.mailboxes[session.key]?.messages.first?.status, "delivery_unconfirmed")
    }

    func testMailboxAnswerMergesTwelveSends() async {
        respond(after: 10, .success(#"{"status":"sent"}"#))
        for n in 1...12 {
            model.drafts[session.key] = Draft(text: "message \(n)")
            await model.sendConversation(session)
        }
        let sent = model.mailboxes[session.key]?.messages ?? []
        XCTAssertEqual(sent.count, 12)
        let answer = sent.suffix(10).map { m -> MailMessage in var m = m; m.local = nil; m.status = "replied"; m.reply = "ok"; return m }
        model.expectMailboxAnswer("00000000-0000-4000-8000-000000000099", deviceId: "dev-1", sessionId: "s1")
        model.apply(LiveMessage(type: "mailbox", deviceId: "dev-1", sessionId: "s1", requestId: "00000000-0000-4000-8000-000000000099", messages: answer))
        let rows = model.mailboxes[session.key]?.messages ?? []
        XCTAssertEqual(rows.count, 12, "Rows outside the ten-row answer were dropped")
        XCTAssertEqual(rows.filter { $0.status == "replied" }.count, 10)
        XCTAssertEqual(Set(rows.map(\.id)).count, 12)
    }

    /// A fake relay: each request reaches it after its own upload time and is answered at once. `arrived`
    /// lists the requests in the order the relay received them.
    private var arrived: [String] = []
    private func relay(upload: @escaping (MessagePayload) -> Int, refuse: Set<String> = []) {
        model.transport = { [weak self] payload, _, _ in
            try await Task.sleep(for: .milliseconds(upload(payload)))
            self?.arrived.append(payload.prompt)
            if refuse.contains(payload.prompt) { throw Relay.Failure(status: 400, message: "Refused") }
            return Data(#"{"status":"sent"}"#.utf8)
        }
    }
    private func start(_ text: String, photos: [PickedPhoto] = [], in s: Session) -> Task<Void, Never> {
        model.drafts[s.key] = Draft(text: text, photos: photos)
        let task = Task { await model.sendConversation(s) }
        return task
    }

    /// A message with a photo, slow to upload, then a text-only one: the relay receives them in that
    /// order, and the composer was free for the second one at once.
    func testPhotoThenTextReachTheRelayInOrder() async throws {
        arrived = []
        relay(upload: { $0.attachments == nil ? 20 : 600 })
        let first = start("1 photo", photos: [try photo()], in: session)
        try? await Task.sleep(for: .milliseconds(40))
        XCTAssertTrue(model.drafts[session.key]?.isEmpty ?? true, "Composer not free while the photo uploads")
        let second = start("2 text", in: session)
        await first.value; await second.value
        XCTAssertEqual(arrived, ["1 photo", "2 text"], "A later text overtook the photo")
        XCTAssertEqual(model.mailboxes[session.key]?.messages.map(\.status), ["awaiting_reply", "awaiting_reply"])
    }

    /// Another session does not wait for this session's slow upload.
    func testOtherSessionDoesNotWait() async throws {
        arrived = []
        relay(upload: { $0.attachments == nil ? 20 : 600 })
        let slow = start("A photo", photos: [try photo()], in: session)
        try? await Task.sleep(for: .milliseconds(40))
        let quick = start("B text", in: other)
        await quick.value
        XCTAssertEqual(arrived, ["B text"], "The other session waited for this one")
        await slow.value
        XCTAssertEqual(arrived, ["B text", "A photo"])
    }

    /// A refused send ends only its own turn: the next one still goes, in order. The refused one comes
    /// back into the composer, which the second send had left empty.
    func testRefusalDoesNotStopTheNextSend() async throws {
        arrived = []
        relay(upload: { $0.prompt.hasPrefix("1") ? 300 : 20 }, refuse: ["1 refused"])
        let first = start("1 refused", in: session)
        try? await Task.sleep(for: .milliseconds(40))
        let second = start("2 next", in: session)
        await first.value; await second.value
        XCTAssertEqual(arrived, ["1 refused", "2 next"])
        XCTAssertEqual(model.mailboxes[session.key]?.messages.map(\.text), ["2 next"])
        XCTAssertEqual(model.mailboxes[session.key]?.messages.map(\.status), ["awaiting_reply"])
        XCTAssertEqual(model.drafts[session.key]?.text, "1 refused", "The refused send is not back in the composer")
        XCTAssertEqual(model.drafts[session.key]?.error, "Refused")
    }
}
