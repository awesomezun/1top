import XCTest
@testable import OneTop

/// Delivery only moves forward, and a mailbox answer (the ten most recently changed rows) is merged
/// by ID into what is shown, never replacing it.
final class ConversationTests: XCTestCase {
    private func row(_ n: Int, _ status: String, reply: String? = nil, activity: String? = nil, local: Bool? = nil) -> MailMessage {
        MailMessage(id: String(format: "00000000-0000-4000-8000-%012d", n), text: "message \(n)", created: Double(n), status: status,
                    reply: reply, local: local, activity: activity.map { MailActivity(phase: $0, observedAt: 100) })
    }

    func testDeliveryNeverGoesBack() {
        XCTAssertEqual(Conversation.advance("replied", to: "awaiting_reply", hasReply: true), "replied")
        XCTAssertEqual(Conversation.advance("replied", to: "sending", hasReply: false), "replied")
        XCTAssertEqual(Conversation.advance("awaiting_reply", to: "sending", hasReply: false), "awaiting_reply")
        XCTAssertEqual(Conversation.advance("sending", to: "awaiting_reply", hasReply: false), "awaiting_reply")
        XCTAssertEqual(Conversation.advance("queued", to: "sending", hasReply: false), "sending")
    }

    func testProblemsAreReportedButAReplyStands() {
        XCTAssertEqual(Conversation.advance("awaiting_reply", to: "not_delivered", hasReply: false), "not_delivered")
        XCTAssertEqual(Conversation.advance("sending", to: "delivery_unconfirmed", hasReply: false), "delivery_unconfirmed")
        XCTAssertEqual(Conversation.advance("replied", to: "not_delivered", hasReply: true), "replied")
        // The computer's own forward state replaces a local doubt.
        XCTAssertEqual(Conversation.advance("delivery_unconfirmed", to: "awaiting_reply", hasReply: false), "awaiting_reply")
    }

    func testTwelveSentMessagesSurviveATenRowAnswer() {
        let shown = (1...12).map { row($0, "sending", local: true) }
        let answer = (3...12).map { row($0, "awaiting_reply") }
        let merged = Conversation.merge(shown, with: answer)
        XCTAssertEqual(merged.count, 12)
        XCTAssertEqual(Set(merged.map(\.id)).count, 12, "Duplicates after matching by request ID")
        XCTAssertEqual(merged.filter { $0.status == "awaiting_reply" }.count, 10)
        XCTAssertEqual(merged.first?.status, "sending", "A row outside the answer changed")
        XCTAssertTrue(merged.filter { $0.status == "awaiting_reply" }.allSatisfy { $0.local == false })
    }

    func testLateReplyIsKept() {
        let shown = [row(1, "replied", reply: "done"), row(2, "awaiting_reply")]
        // The replied row is no longer in the answer, or comes back older: it keeps its reply.
        var merged = Conversation.merge(shown, with: [row(2, "awaiting_reply")])
        XCTAssertEqual(merged.first?.status, "replied")
        XCTAssertEqual(merged.first?.reply, "done")
        merged = Conversation.merge(merged, with: [row(1, "awaiting_reply")])
        XCTAssertEqual(merged.first?.status, "replied")
        XCTAssertEqual(merged.first?.reply, "done")
        // A reply that arrives later is applied.
        merged = Conversation.merge(merged, with: [row(2, "replied", reply: "later")])
        XCTAssertEqual(merged.last?.reply, "later")
        XCTAssertEqual(merged.last?.status, "replied")
    }

    func testActivityComesOnlyFromTheLatestAnswer() {
        let shown = [row(1, "awaiting_reply", activity: "writing"), row(2, "awaiting_reply", activity: "working")]
        let merged = Conversation.merge(shown, with: [row(2, "awaiting_reply", activity: "responding")])
        XCTAssertNil(merged[0].activity, "Activity kept on a row the answer did not mention")
        XCTAssertEqual(merged[1].activity?.phase, "responding")
        XCTAssertNil(Conversation.merge(merged, with: []).compactMap(\.activity).first, "Activity kept after an empty answer")
    }
}
