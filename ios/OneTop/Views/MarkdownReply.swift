import SwiftUI

/// An agent's reply drawn from its Markdown (Markdown.blocks) as the web dashboard draws it (dashboard.css `.md`):
/// blocks 8 points apart, headings a little larger, lists with muted markers, quotes behind a bar, code and
/// tables in boxes that scroll sideways. VoiceOver and UI tests read the reply as one text, as before, without
/// the marks; each link is an action on it.
struct MarkdownReply: View {
    var text: String
    @Environment(\.openURL) private var openURL

    var body: some View {
        let blocks = Markdown.blocks(text)
        MarkdownBlocks(blocks: blocks, spacing: 8)
            .textSelection(.enabled)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Self.spoken(blocks))
            .accessibilityAddTraits(.isStaticText)
            .accessibilityActions {
                ForEach(Array(Self.links(blocks).enumerated()), id: \.offset) { _, link in
                    Button(link.text) { openURL(link.url) }
                }
            }
    }

    /// The reply as read out: block by block, list items with their numbers, table rows cell by cell.
    private static func spoken(_ blocks: [Markdown.Block]) -> String {
        blocks.compactMap { block -> String? in
            switch block {
            case .paragraph(let lines): lines.map(plain).joined(separator: "\n")
            case .heading(_, let line): plain(line)
            case .list(let list): spoken(list)
            case .quote(let inner): spoken(inner)
            case .code(let code): code
            case .table(let head, let rows): ([head] + rows).map { $0.map(plain).joined(separator: ", ") }.joined(separator: "\n")
            case .rule: nil
            }
        }.joined(separator: "\n")
    }

    private static func spoken(_ list: Markdown.List) -> String {
        list.items.enumerated().map { i, item in
            (list.ordered ? "\(list.start + i). " : "") + item.lines.map(plain).joined(separator: "\n") + item.lists.map { "\n" + spoken($0) }.joined()
        }.joined(separator: "\n")
    }

    private static func plain(_ line: Markdown.Line) -> String { line.map(\.text).joined() }

    /// Every link in the reply with its text, runs of one link taken together.
    private static func links(_ blocks: [Markdown.Block]) -> [(text: String, url: URL)] {
        var out: [(text: String, url: URL)] = []
        for line in lines(blocks) {
            var previous: URL?
            for run in line {
                if let url = run.link {
                    if previous == url { out[out.count - 1].text += run.text } else { out.append((run.text, url)) }
                }
                previous = run.link
            }
        }
        return out
    }

    private static func lines(_ blocks: [Markdown.Block]) -> [Markdown.Line] {
        blocks.flatMap { block -> [Markdown.Line] in
            switch block {
            case .paragraph(let lines): lines
            case .heading(_, let line): [line]
            case .list(let list): lines(list)
            case .quote(let inner): lines(inner)
            case .table(let head, let rows): head + rows.flatMap { $0 }
            case .code, .rule: []
            }
        }
    }

    private static func lines(_ list: Markdown.List) -> [Markdown.Line] {
        list.items.flatMap { $0.lines + $0.lists.flatMap(lines) }
    }
}

/// Lines and fills from the text colour, so they hold over the bubble in light and dark; the code box takes
/// the screen's own background, darker than the bubble in dark and lighter in light, as on the web.
private enum Palette {
    static let line = Color.primary.opacity(0.13)
    static let strongLine = Color.primary.opacity(0.24)
    static let raised = Color.primary.opacity(0.07)
    static let well = Color(uiColor: .systemBackground).opacity(0.55)

    /// Lines of runs as one text with their line breaks. Code is monospaced a size down on a raised fill; a link
    /// is underlined in the accent colour.
    static func text(_ lines: [Markdown.Line], size: CGFloat) -> AttributedString {
        var out = AttributedString()
        for (k, line) in lines.enumerated() {
            if k > 0 { out += AttributedString("\n") }
            for run in line {
                var part = AttributedString(run.text)
                var intent: InlinePresentationIntent = []
                if run.bold { intent.insert(.stronglyEmphasized) }
                if run.italic { intent.insert(.emphasized) }
                if !intent.isEmpty { part.inlinePresentationIntent = intent }
                if run.strike { part.swiftUI.strikethroughStyle = .single }
                if run.code {
                    part.swiftUI.font = .system(size: size * 0.88, design: .monospaced)
                    part.swiftUI.backgroundColor = raised
                }
                if let url = run.link {
                    part.link = url
                    part.swiftUI.underlineStyle = .single
                }
                out += part
            }
        }
        return out
    }
}

private struct MarkdownBlocks: View {
    var blocks: [Markdown.Block]
    var spacing: CGFloat
    @ScaledMetric(relativeTo: .body) private var em: CGFloat = 17

    var body: some View {
        VStack(alignment: .leading, spacing: spacing) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                switch block {
                case .paragraph(let lines):
                    Text(Palette.text(lines, size: em))
                case .heading(let level, let line):
                    let size = em * (level <= 3 ? [1.18, 1.1, 1.04][level - 1] : 1)
                    Text(Palette.text([line], size: size)).font(.system(size: size, weight: .bold))
                case .list(let list):
                    MarkdownList(list: list, depth: 0)
                case .quote(let inner):
                    MarkdownBlocks(blocks: inner, spacing: 6)
                        .foregroundStyle(.secondary)
                        .padding(.leading, 13)
                        .overlay(alignment: .leading) { Rectangle().fill(Palette.strongLine).frame(width: 3) }
                case .code(let code):
                    ScrollView(.horizontal) {
                        Text(verbatim: code).font(.system(size: em * 0.88, design: .monospaced)).lineSpacing(3)
                            .padding(.horizontal, 11).padding(.vertical, 9)
                    }
                    .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Palette.well, in: RoundedRectangle(cornerRadius: 9))
                    .overlay(RoundedRectangle(cornerRadius: 9).strokeBorder(Palette.line))
                    .clipShape(RoundedRectangle(cornerRadius: 9))
                case .table(let head, let rows):
                    MarkdownTable(head: head, rows: rows)
                case .rule:
                    Rectangle().fill(Palette.line).frame(height: 1)
                }
            }
        }
    }
}

/// Items under muted markers: a bullet that turns hollow, then square, as lists nest, or the item's number,
/// right-aligned so items line up past nine.
private struct MarkdownList: View {
    var list: Markdown.List
    var depth: Int
    @ScaledMetric(relativeTo: .body) private var em: CGFloat = 17

    var body: some View {
        let last = list.start + list.items.count - 1
        VStack(alignment: .leading, spacing: 3) {
            ForEach(Array(list.items.enumerated()), id: \.offset) { i, item in
                HStack(alignment: .firstTextBaseline, spacing: 0) {
                    ZStack(alignment: .trailing) {
                        if list.ordered { Text(verbatim: "\(last).").hidden() }
                        Text(verbatim: list.ordered ? "\(list.start + i)." : ["•", "◦", "▪\u{FE0E}"][min(depth, 2)])
                    }
                    .monospacedDigit().foregroundStyle(.secondary)
                    .frame(minWidth: em * 0.95, alignment: .trailing)
                    .padding(.trailing, em * 0.4)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(Palette.text(item.lines, size: em))
                        ForEach(Array(item.lists.enumerated()), id: \.offset) { _, nested in
                            MarkdownList(list: nested, depth: depth + 1)
                        }
                    }
                }
            }
        }
    }
}

/// A table at its own width, each cell on one line, scrolling sideways when wider than the bubble. Each cell
/// draws its own border; neighbours share theirs, and the inset keeps the outer ones from being clipped.
private struct MarkdownTable: View {
    var head: [Markdown.Line]
    var rows: [[Markdown.Line]]
    @ScaledMetric(relativeTo: .body) private var em: CGFloat = 17

    var body: some View {
        ScrollView(.horizontal) {
            Grid(alignment: .topLeading, horizontalSpacing: 0, verticalSpacing: 0) {
                GridRow { ForEach(head.indices, id: \.self) { cell(head[$0], header: true) } }
                ForEach(rows.indices, id: \.self) { r in
                    GridRow { ForEach(rows[r].indices, id: \.self) { cell(rows[r][$0], header: false) } }
                }
            }
            .padding(1)
        }
        .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
    }

    private func cell(_ line: Markdown.Line, header: Bool) -> some View {
        Text(Palette.text([line], size: em * 0.92)).font(.system(size: em * 0.92, weight: header ? .semibold : .regular))
            .lineLimit(1).fixedSize()
            .padding(.horizontal, 9).padding(.vertical, 4)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(header ? Palette.raised : .clear, in: Rectangle())
            .overlay { Rectangle().stroke(Palette.line, lineWidth: 1) }
    }
}
