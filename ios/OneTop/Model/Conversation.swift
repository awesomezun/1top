import Foundation

/// How one session's message list changes as receipts and mailbox answers arrive, kept apart from
/// the views so it can be tested. Messages are matched by ID, which is the request ID they were sent
/// with, so a message sent from this phone and its row from the computer are the same message.
enum Conversation {
    /// Delivery moves forward only: queued < sending < awaiting_reply < replied. A late receipt can
    /// never send a replied message back to waiting. Problems (unconfirmed, source changed, not
    /// delivered) are reported as they come, except that a message with a reply keeps it: the reply
    /// proves it arrived. A forward state from the computer replaces an earlier local doubt.
    static func advance(_ old: String, to new: String, hasReply: Bool) -> String {
        let order = ["queued": 0, "sending": 1, "awaiting_reply": 2, "replied": 3]
        if hasReply || old == "replied" { return "replied" }
        guard let next = order[new] else { return new }
        guard let now = order[old] else { return new }
        return next >= now ? new : old
    }

    /// Merges the computer's answer into what is on screen. The computer returns only the ten most
    /// recently changed unfinished messages, so nothing is removed: rows in the answer are updated
    /// or added by ID, others stay as they are. Activity belongs only to rows in this answer.
    static func merge(_ shown: [MailMessage], with answer: [MailMessage]) -> [MailMessage] {
        var rows = shown.map { m -> MailMessage in var m = m; m.activity = nil; return m }
        for incoming in answer {
            if let i = rows.firstIndex(where: { $0.id == incoming.id }) {
                var row = rows[i]
                let reply = nonEmpty(incoming.reply) ?? nonEmpty(row.reply)
                row.status = advance(row.status, to: incoming.status, hasReply: reply != nil)
                row.reply = reply
                row.replyAt = incoming.replyAt ?? row.replyAt
                row.truncated = incoming.truncated ?? row.truncated
                if !incoming.text.isEmpty { row.text = incoming.text }
                if let files = incoming.attachments, !files.isEmpty { row.attachments = files }
                row.activity = incoming.activity
                row.local = false
                rows[i] = row
            } else {
                rows.append(incoming)
            }
        }
        return rows.sorted { $0.created < $1.created }
    }

    private static func nonEmpty(_ text: String?) -> String? {
        guard let text, !text.isEmpty else { return nil }
        return text
    }
}
