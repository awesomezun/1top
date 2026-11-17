import AppKit
// Preserve the existing waveform.path identity used by the menu-bar app.
let output = URL(fileURLWithPath:CommandLine.arguments[1])
try FileManager.default.createDirectory(at:output,withIntermediateDirectories:true)
for (file,white,opaque) in [("mark",false,false),("menu-mark",true,false),("icon",false,true)] {
 let mint=NSColor(srgbRed:0.43,green:0.80,blue:0.66,alpha:1)
 let conf=NSImage.SymbolConfiguration(pointSize:600,weight:.semibold).applying(.init(paletteColors:[white ? .white : mint]))
 let symbol=NSImage(systemSymbolName:"waveform.path",accessibilityDescription:"1top")!.withSymbolConfiguration(conf)!
 let rep=NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:1024,pixelsHigh:1024,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0)!
 NSGraphicsContext.saveGraphicsState();NSGraphicsContext.current=NSGraphicsContext(bitmapImageRep:rep)
 if opaque { NSColor(srgbRed:0.055,green:0.063,blue:0.075,alpha:1).setFill();NSBezierPath(rect:NSRect(x:0,y:0,width:1024,height:1024)).fill() }
 let limit:CGFloat=opaque ? 680 : 940,scale=min(limit/symbol.size.width,limit/symbol.size.height)
 let size=NSSize(width:symbol.size.width*scale,height:symbol.size.height*scale)
 symbol.draw(in:NSRect(x:(1024-size.width)/2,y:(1024-size.height)/2,width:size.width,height:size.height))
 NSGraphicsContext.restoreGraphicsState()
 try rep.representation(using:.png,properties:[:])!.write(to:output.appendingPathComponent(file+".png"))
}
