import AppKit
// The same system symbol used by the native status item, exported for its web frame.
let folder = URL(fileURLWithPath: CommandLine.arguments[1])
try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true)
for (file,symbol) in [("1top","waveform.path"),("apple","apple.logo"),("wifi","wifi"),("battery","battery.100percent")] {
    let image=NSImage(systemSymbolName:symbol,accessibilityDescription:file)!.withSymbolConfiguration(NSImage.SymbolConfiguration(paletteColors:[.white]))!
    let rep=NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:48,pixelsHigh:48,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0)!
    NSGraphicsContext.saveGraphicsState();NSGraphicsContext.current=NSGraphicsContext(bitmapImageRep:rep)
    let scale=min(40/image.size.width,40/image.size.height),size=NSSize(width:image.size.width*scale,height:image.size.height*scale)
    image.draw(in:NSRect(x:(48-size.width)/2,y:(48-size.height)/2,width:size.width,height:size.height))
    NSGraphicsContext.restoreGraphicsState()
    try rep.representation(using:.png,properties:[:])!.write(to:folder.appendingPathComponent(file+".png"))
}
