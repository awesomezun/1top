import SwiftUI
import UIKit

/// The theme and language change spreads out from where it was tapped, as on the web dashboard:
/// a snapshot of the old screen covers the window, the change happens underneath, and a circle
/// cut into the snapshot grows from the tap until the old screen is gone. With Reduce Motion the
/// change is immediate. Taps during a reveal are ignored, so repeated taps cannot stack snapshots.
@MainActor
enum Reveal {
    private static var running = false
    static let duration: CFTimeInterval = 0.5

    /// Runs `change` under a circular reveal centred on `point` (window coordinates).
    static func perform(at point: CGPoint, _ change: () -> Void) {
        guard !running else { return }
        guard !UIAccessibility.isReduceMotionEnabled,
              let window = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene })
                .flatMap(\.windows).first(where: \.isKeyWindow),
              let snapshot = window.snapshotView(afterScreenUpdates: false)
        else { change(); return }
        running = true
        snapshot.frame = window.bounds
        // The snapshot is only a picture: touches and VoiceOver go to the live screen beneath.
        snapshot.isUserInteractionEnabled = false
        snapshot.accessibilityElementsHidden = true
        window.addSubview(snapshot)
        change()

        let bounds = window.bounds
        let far = hypot(max(point.x, bounds.width - point.x), max(point.y, bounds.height - point.y)) + 2
        func hole(_ radius: CGFloat) -> CGPath {
            let path = UIBezierPath(rect: bounds)
            path.append(UIBezierPath(arcCenter: point, radius: radius, startAngle: 0, endAngle: 2 * .pi, clockwise: true))
            return path.cgPath
        }
        let mask = CAShapeLayer()
        mask.frame = bounds
        mask.fillRule = .evenOdd
        mask.path = hole(far)
        snapshot.layer.mask = mask

        let grow = CABasicAnimation(keyPath: "path")
        grow.fromValue = hole(0.5)
        grow.toValue = hole(far)
        grow.duration = duration
        grow.timingFunction = CAMediaTimingFunction(name: .easeOut)
        CATransaction.begin()
        CATransaction.setCompletionBlock {
            snapshot.removeFromSuperview()
            running = false
        }
        mask.add(grow, forKey: "reveal")
        CATransaction.commit()
    }
}
