import Foundation

/// The iPhone copy of site/src/demo-usage.js (and mobile/src/demo-usage.ts): demo token use with the
/// shape of real use. Work comes in bursts with short pauses, some hours rest completely, a minute's
/// tokens have a long tail, and one session carries most of the load. Every number comes from a hash
/// of (seed, time, slot), so the same seed gives the same minutes on both phones and the past never
/// changes as time goes on. Keep the three copies the same: the same operations in the same order.
/// DemoUsageTests asserts the check values the other two test suites assert too.
enum DemoUsage {
    typealias Table = [(Double, Double)]
    /// Inverse distribution functions as (probability, value) points, from one computer's collector over
    /// a working day (1-minute bins): active runs and pauses in minutes, and an active minute's tokens
    /// over its median.
    static let run: Table = [(0, 1), (0.5, 5), (0.9, 31), (0.99, 90), (1, 135)]
    static let pause: Table = [(0, 1), (0.5, 1.5), (0.9, 9), (0.98, 30), (1, 60)]
    static let amount: Table = [(0, 0.05), (0.1, 0.22), (0.5, 1), (0.9, 3.04), (0.99, 4.99), (1, 7.07)]
    /// Hours of complete rest in each 6-hour block, and how busy a working hour is.
    static let rest: Table = [(0, 0), (0.5, 0), (0.75, 1.99), (0.88, 2.99), (0.96, 4.99), (1, 5.99)]
    static let level: Table = [(0, 0.15), (0.2, 0.5), (0.5, 1), (0.85, 1.5), (1, 2.2)]
    /// How many of a working hour's active minutes stay: some hours are dense, some scattered.
    static let density: Table = [(0, 0.45), (0.3, 0.8), (0.6, 1), (1, 1)]
    /// How a session's share of its computer moves from hour to hour, so the busiest one changes.
    static let share: Table = [(0, 0.1), (0.3, 0.5), (0.7, 1.2), (1, 2.5)]
    static let block = 360
    /// Fresh input, cache reads, cache writes and output, as a collector reports them.
    static let mix: [Double] = [0.005, 0.981, 0.009, 0.005]

    struct Stream { var weight: Double; var start: Double; var stop: Double }
    struct Usage { var first: Int; var last: Int; var minutes: [[Double]] }

    /// A number in [0, 1) from three whole numbers.
    static func unit(_ seed: UInt32, _ a: Int, _ b: Int) -> Double {
        var h = seed ^ (UInt32(truncatingIfNeeded: a) &* 0x9E37_79B1)
        h = (h ^ (h >> 16)) &* 0x85EB_CA6B
        h = h ^ (UInt32(truncatingIfNeeded: b + 0x632B_E5AB) &* 0xC2B2_AE35)
        h = (h ^ (h >> 13)) &* 0x27D4_EB2F
        return Double(h ^ (h >> 16)) / 4_294_967_296
    }

    static func quantile(_ u: Double, _ table: Table) -> Double {
        for i in 1..<table.count where u <= table[i].0 {
            let (p0, v0) = table[i - 1], (p1, v1) = table[i]
            return v0 + (v1 - v0) * (u - p0) / (p1 - p0)
        }
        return table[table.count - 1].1
    }

    /// Which minutes of a 6-hour block are active: runs and pauses one after another.
    static func blockRuns(_ seed: UInt32, _ block: Int) -> [Bool] {
        var on = [Bool](repeating: false, count: Self.block)
        var m = 0, k = 0, active = unit(seed, block, 4) < 0.7
        while m < Self.block {
            let length = max(1, Int(floor(quantile(unit(seed, block, 100 + k), active ? run : pause) + 0.5)))
            if active { for i in m..<min(Self.block, m + length) { on[i] = true } }
            m += length; k += 1; active.toggle()
        }
        return on
    }

    static func resting(_ seed: UInt32, _ hour: Int, _ awake: (Int, Int)) -> Bool {
        if hour >= awake.0 && hour < awake.1 { return false }
        let block = hour / 6, length = Int(floor(quantile(unit(seed, block, 1), rest)))
        let start = Int(floor(unit(seed, block, 2) * Double(7 - length))), at = hour - block * 6
        return at >= start && at < start + length
    }

    /// One computer's tokens in each whole minute from first to last (inclusive). scale is the median
    /// tokens of an active minute. Hours in awake never rest, so a demo opens on a working hour. rest
    /// seeds the resting hours: one person's computers share it and rest together. duty keeps that share
    /// of active minutes, for a computer that works less than the main one.
    static func computerMinutes(_ seed: UInt32, _ scale: Double, _ first: Int, _ last: Int, _ awake: (Int, Int) = (0, 0),
                                rest: UInt32? = nil, duty: Double = 1) -> [Double] {
        var out = [Double](repeating: 0, count: last - first + 1), runs: [Int: [Bool]] = [:]
        for m in first...last {
            let hour = m / 60, block = m / Self.block
            let on = runs[block] ?? blockRuns(seed, block)
            runs[block] = on
            // Working hours thin out in 3-minute pieces; the hours the demo opens on are ordinary working hours.
            let dense = hour >= awake.0 && hour < awake.1 ? 0.55 + 0.3 * unit(seed, hour, 8) : quantile(unit(seed, hour, 8), density)
            if !on[m - block * Self.block] || resting(rest ?? seed, hour, awake) || unit(seed, m / 3, 7) >= duty * dense { continue }
            out[m - first] = scale * quantile(unit(seed, hour, 3), level) * quantile(unit(seed, m, 5), amount)
        }
        return out
    }

    /// The minutes of the last day (and a quarter hour more, for 15-minute bins) among a computer's
    /// sessions, each taking part from start until stop. Each active minute goes to one session, picked
    /// by its share, as one agent at a time does most of the work. anchor is when the demo began: with
    /// awake, the hours around it never rest. rest and duty are as in computerMinutes. The current minute
    /// counts for the part of it that has passed.
    static func usage(_ seed: UInt32, _ scale: Double, _ streams: [Stream], now: Double, anchor: Double,
                      rest: UInt32? = nil, duty: Double = 1, awake: Bool = true) -> Usage {
        let last = Int(floor(now / 60)), first = last - 1455, anchorHour = Int(floor(anchor / 3600))
        let total = computerMinutes(seed, scale, first, last, awake ? (anchorHour - 1, anchorHour + 1) : (0, 0), rest: rest, duty: duty)
        let part = (now - Double(last * 60)) / 60
        var minutes = streams.map { _ in [Double](repeating: 0, count: total.count) }
        var hour: Int?, shares: [Double] = []
        for i in 0..<total.count {
            let m = first + i, t = Double(m * 60)
            if total[i] == 0 { continue }
            if m / 60 != hour {
                let h = m / 60
                hour = h
                shares = streams.enumerated().map { j, s in s.weight * quantile(unit(seed, h, 10 + j), share) }
            }
            var sum = 0.0
            for j in streams.indices where t >= streams[j].start && t < streams[j].stop { sum += shares[j] }
            if sum == 0 { continue }
            var pick = unit(seed, m, 6) * sum, chosen = -1
            for j in streams.indices where t >= streams[j].start && t < streams[j].stop {
                chosen = j
                pick -= shares[j]
                if pick < 0 { break }
            }
            minutes[chosen][i] = m == last ? total[i] * part : total[i]
        }
        return Usage(first: first, last: last, minutes: minutes)
    }

    /// A session's tokens from a moment until now.
    static func since(_ u: Usage, _ j: Int, _ from: Double) -> Double {
        var n = 0.0
        for (i, v) in u.minutes[j].enumerated() where Double((u.first + i) * 60) >= from { n += v }
        return n
    }

    /// Bins of step seconds over the last seconds, aligned to the clock as a collector aligns them.
    static func bins(_ u: Usage, _ kinds: [String?], now: Double, seconds: Double, step: Double) -> (start: Double, end: Double, bins: [[String: Double]]) {
        let end = floor(now / step) * step + step, start = end - seconds, count = Int(seconds / step)
        var out = [[String: Double]](repeating: [:], count: count)
        for (j, kind) in kinds.enumerated() {
            guard let kind else { continue }
            for (i, v) in u.minutes[j].enumerated() where v != 0 {
                let b = Int(floor((Double((u.first + i) * 60) - start) / step))
                if b < 0 || b >= count { continue }
                out[b][kind, default: 0] += v
            }
        }
        return (start, end, out.map { $0.mapValues { $0.rounded() } })
    }

    static func vector(_ n: Double) -> [Double] {
        let v = mix.prefix(3).map { (n * $0).rounded() }
        return [v[0], v[1], v[2], n.rounded() - v[0] - v[1] - v[2]]
    }
}
