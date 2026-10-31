// Records one window of the recording build with ScreenCaptureKit.
//
// Usage: window-film <window id> <output.mov> <seconds>
// The stream covers that window's rectangle of its display with every other
// application excluded, so only the recording build's own windows are
// composited: no other window, wallpaper, cursor or notification. (A stream
// aimed at the window itself, or at an included application, makes the system
// badge the window's title bar while it is shared.) Applications that start
// during the take are excluded within half a second; if one of them showed a
// window over the recorded rectangle the take is reported as unusable.
// Frames are written as ProRes 422 HQ when the window changes, up to 30 per
// second. "RECORDING" is printed once the first frame is written.
import AppKit
import AVFoundation
import CoreMedia
import ScreenCaptureKit

func fail(_ message: String) -> Never { FileHandle.standardError.write((message + "\n").data(using: .utf8)!); exit(1) }

final class Film: NSObject, SCStreamOutput, SCStreamDelegate {
    let writer: AVAssetWriter, input: AVAssetWriterInput, seconds: Double
    var first: CMTime?, finished = false, frames = 0
    let done = DispatchSemaphore(value: 0)
    var stream: SCStream?

    init(url: URL, width: Int, height: Int, seconds: Double) throws {
        try? FileManager.default.removeItem(at: url)
        writer = try AVAssetWriter(outputURL: url, fileType: .mov)
        input = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.proRes422HQ, AVVideoWidthKey: width, AVVideoHeightKey: height])
        input.expectsMediaDataInRealTime = true
        writer.add(input)
        self.seconds = seconds
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer buffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, !finished, buffer.isValid,
              let info = (CMSampleBufferGetSampleAttachmentsArray(buffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]])?.first,
              (info[.status] as? Int).flatMap(SCFrameStatus.init) == .complete else { return }
        let time = buffer.presentationTimeStamp
        if first == nil {
            first = time
            writer.startWriting(); writer.startSession(atSourceTime: time)
            print("RECORDING"); fflush(stdout)
        }
        if input.isReadyForMoreMediaData { input.append(buffer); frames += 1 }
        else { FileHandle.standardError.write("dropped a frame at \((time - first!).seconds) s\n".data(using: .utf8)!) }
        if (time - first!).seconds >= seconds { finish() }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        FileHandle.standardError.write("stream stopped: \(error)\n".data(using: .utf8)!); finish()
    }

    // The window may stay unchanged at the end; its last frame then lasts until the full length.
    func finish() {
        guard !finished else { return }
        finished = true
        stream?.stopCapture { _ in
            guard let first = self.first else { self.done.signal(); return }
            self.input.markAsFinished()
            self.writer.endSession(atSourceTime: first + CMTime(seconds: self.seconds, preferredTimescale: 6000))
            self.writer.finishWriting { print("FRAMES \(self.frames)"); fflush(stdout); self.done.signal() }
        }
    }
}

let surface = CGColor(red: 16 / 255, green: 18 / 255, blue: 22 / 255, alpha: 1)  // kept alive: the configuration does not retain it

func record(_ id: CGWindowID, to url: URL, seconds: Double) async throws {
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    guard let window = content.windows.first(where: { $0.windowID == id }), let owner = window.owningApplication else { fail("window \(id) is not on screen") }
    guard let display = content.displays.first(where: { $0.frame.contains(CGPoint(x: window.frame.midX, y: window.frame.midY)) }) else { fail("no display shows window \(id)") }
    var excluded = content.applications.filter { $0.processID != owner.processID }
    let filter = SCContentFilter(display: display, excludingApplications: excluded, exceptingWindows: [])
    let config = SCStreamConfiguration()
    let scale = CGFloat(filter.pointPixelScale)
    config.sourceRect = window.frame.offsetBy(dx: -display.frame.minX, dy: -display.frame.minY)
    config.width = Int(window.frame.width * scale); config.height = Int(window.frame.height * scale)
    config.backgroundColor = surface
    config.minimumFrameInterval = CMTime(value: 1, timescale: 30)
    config.pixelFormat = kCVPixelFormatType_32BGRA
    config.showsCursor = false
    config.queueDepth = 8
    let film = try Film(url: url, width: config.width, height: config.height, seconds: seconds)
    let stream = SCStream(filter: filter, configuration: config, delegate: film)
    film.stream = stream
    try stream.addStreamOutput(film, type: .screen, sampleHandlerQueue: DispatchQueue(label: "film"))
    try await stream.startCapture()
    print("SIZE \(config.width) \(config.height)"); fflush(stdout)
    DispatchQueue.global().asyncAfter(deadline: .now() + seconds + 3) { film.finish() }
    // Exclude applications that start during the take.
    var unusable = false
    while !film.finished {
        try await Task.sleep(nanoseconds: 500_000_000)
        guard let now = try? await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true) else { continue }
        let known = Set(excluded.map(\.processID) + [owner.processID])
        let late = now.applications.filter { !known.contains($0.processID) }
        guard !late.isEmpty else { continue }
        excluded += late
        try? await stream.updateContentFilter(SCContentFilter(display: display, excludingApplications: excluded, exceptingWindows: []))
        for app in late {
            let covering = now.windows.filter { $0.owningApplication?.processID == app.processID && $0.isOnScreen && $0.frame.intersects(window.frame) }
            FileHandle.standardError.write("excluded late application \(app.bundleIdentifier) pid \(app.processID) \(app.applicationName)\n".data(using: .utf8)!)
            for w in covering { FileHandle.standardError.write("  window \(w.windowID) layer \(w.windowLayer) \(w.frame) title \(w.title ?? "-")\n".data(using: .utf8)!) }
            unusable = unusable || !covering.isEmpty
        }
    }
    await withCheckedContinuation { done in DispatchQueue.global().async { film.done.wait(); done.resume() } }
    if unusable { print("UNUSABLE another application showed a window over the recorded area"); fflush(stdout) }
}

let args = CommandLine.arguments
guard args.count == 4, let id = CGWindowID(args[1]), let seconds = Double(args[3]) else {
    FileHandle.standardError.write("usage: window-film <window id> <output.mov> <seconds>\n".data(using: .utf8)!); exit(2)
}
_ = NSApplication.shared  // a window server connection for ScreenCaptureKit
Task.detached {
    do { try await record(id, to: URL(fileURLWithPath: args[2]), seconds: seconds) } catch { fail("recording failed: \(error)") }
    exit(0)
}
dispatchMain()
