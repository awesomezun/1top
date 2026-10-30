// Written by scripts/demo-world.mjs from site/src/demo-world.js. Do not edit by hand.
// The web model's numbers at checkAt (as both the demo's start and now); DemoWorldTests checks the
// iPhone's model gives the same.
enum DemoWorldExpected {
    static let checkAt: Double = 1800000000
    /// (session, last hour, last day, rate, total) in tokens.
    static let sessions: [(String, Double, Double, Double, Double)] = [
        ("s1", 52347703, 821959167, 10556, 2321959167),
        ("s2", 12332649, 133281374, 5004, 533281374),
        ("s3", 798856, 129172523, 0, 429172523),
        ("s4", 1280410, 54007514, 0, 154007514),
        ("s5", 0, 38682030, 0, 113682030),
        ("s6", 0, 67082732, 0, 217082732),
        ("s7", 4593434, 44617361, 0, 144617361),
        ("s9", 7612222, 152316729, 0, 352316729),
        ("s11", 0, 16022732, 0, 116022732),
        ("s12", 0, 10320616, 0, 60320616),
        ("s1-reviewer", 23380154, 232014522, 941, 1732014522),
        ("s1-tester", 4718586, 54394640, 0, 1554394640),
        ("s2-migrator", 1137729, 93037192, 0, 493037192),
        ("m1", 0, 25620795, 0, 125620795),
        ("m2", 0, 14812055, 0, 114812055),
        ("w1", 17833940, 162788121, 8738, 862788121),
        ("w2", 824492, 61774420, 0, 211774420),
        ("w3", 0, 25932551, 0, 100932551),
        ("w6", 0, 10245424, 0, 60245424),
    ]
    /// (computer, CPU %, memory in use in bytes).
    static let hosts: [(String, Double, Double)] = [
        ("demo-0", 15.5, 23656679866),
        ("demo-1", 12.3, 16106127360),
        ("demo-2", 20.3, 40802189312),
    ]
    /// (account, weekly %, 5-hour % or -1, day, five hours and hour in percentage points).
    static let accounts: [(String, Double, Double, Double, Double, Double)] = [
        ("dev", 61, 29, 18.9384, 5.6117, 1.4253),
        ("studio", 33, 0, 8.3325, 2.1027, 0.0431),
        ("ops", 71, -1, 18.8344, 2.3378, 0.1072),
        ("ml", 18, -1, 4.2582, 0.7651, 0.2425),
    ]
}
