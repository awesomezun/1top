import XCTest
@testable import OneTop

/// An agent's reply reads by the web dashboard's Markdown rules. The blocks are written out as the web's HTML
/// (conversation.js `markdown`), so the assertions are the web's own (tests/conversation.mjs), input and output.
final class MarkdownTests: XCTestCase {
    private func md(_ text: String) -> String { html(Markdown.blocks(text)) }

    func testTheWebAssertions() {
        XCTAssertEqual(md("**1. 푸시**\n- `c974ed4` 올림\n  - 하위 snake_case 2 * 3"),
                       "<p><strong>1. 푸시</strong></p><ul><li><code>c974ed4</code> 올림<ul><li>하위 snake_case 2 * 3</li></ul></li></ul>")
        XCTAssertEqual(md("첫 줄\n둘째 줄"), "<p>첫 줄<br>둘째 줄</p>")
        XCTAssertEqual(md("1. 하나\n\n2. 둘"), "<ol><li>하나</li><li>둘</li></ol>")
        XCTAssertEqual(md("- [x] 끝\n- [ ] 남음"), "<ul><li>☑ 끝</li><li>☐ 남음</li></ul>")
        XCTAssertEqual(md("## 제목"), "<p class=\"md-h md-h2\" role=\"heading\" aria-level=\"2\">제목</p>")
        XCTAssertEqual(md("```\n<b>x</b>\n```"), "<pre><code>&lt;b&gt;x&lt;/b&gt;</code></pre>")
        XCTAssertEqual(md("| a | b |\n|---|---|\n| 1 | **2** |"),
                       "<div class=\"md-table\"><table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td><strong>2</strong></td></tr></tbody></table></div>")
        XCTAssertEqual(md("> 인용\n---"), "<blockquote><p>인용</p></blockquote><hr>")
        XCTAssertEqual(md("[문서](https://x.com/?a=1&b=2)와 https://1top.si/app."),
                       "<p><a href=\"https://x.com/?a=1&amp;b=2\" target=\"_blank\" rel=\"noopener noreferrer\">문서</a>와 <a href=\"https://1top.si/app\" target=\"_blank\" rel=\"noopener noreferrer\">https://1top.si/app</a>.</p>")
        XCTAssertEqual(md("[x](javascript:alert(1)) <img src=x onerror=a()>"), "<p>[x](javascript:alert(1)) &lt;img src=x onerror=a()&gt;</p>")
        XCTAssertEqual(md("~~옛~~ *기울임* _도_ __굵게__"), "<p><del>옛</del> <em>기울임</em> <em>도</em> <strong>굵게</strong></p>")
    }

    // The cases below and their HTML come from the web's markdown() as well, quirks included.
    func testListsNestByIndentAndCountOn() {
        XCTAssertEqual(md("3. 셋\n4. 넷"), "<ol start=\"3\"><li>셋</li><li>넷</li></ol>")
        XCTAssertEqual(md("0. 영\n1. 하나"), "<ol><li>영</li><li>하나</li></ol>")
        // A change between numbered and bulleted at one depth starts a new list; a shallower item closes back.
        XCTAssertEqual(md("- a\n1. b\n  - c\n\t- d\n- e"),
                       "<ul><li>a</li></ul><ol><li>b<ul><li>c</li><li>d</li></ul></li></ol><ul><li>e</li></ul>")
        XCTAssertEqual(md("- a\n    - b\n  - c"), "<ul><li>a<ul><li>b</li></ul><ul><li>c</li></ul></li></ul>")
        // An indented line runs the item on; a blank line before it ends the list.
        XCTAssertEqual(md("- a\n  이어서\n\n  문단"), "<ul><li>a<br>이어서</li></ul><p>문단</p>")
        XCTAssertEqual(md("- [x]\n- [X] 대문자"), "<ul><li>[x]</li><li>☑ 대문자</li></ul>")
        XCTAssertEqual(md("- - -\n* * *"), "<hr><hr>")
    }

    func testBlocksEndParagraphsAndRunToTheirEnds() {
        XCTAssertEqual(md("문단\n# 제목 ##\n문단"), "<p>문단</p><p class=\"md-h md-h1\" role=\"heading\" aria-level=\"1\">제목</p><p>문단</p>")
        XCTAssertEqual(md("#태그 아님"), "<p>#태그 아님</p>")
        // An unclosed fence runs to the end; the info string is dropped and indentation inside is kept.
        XCTAssertEqual(md("~~~swift\n  let a = 1\n\n**b**"), "<pre><code>  let a = 1\n\n**b**</code></pre>")
        // Rows take the header's cell count.
        XCTAssertEqual(md("a|b\n-|-\n1|\n1|2|3"),
                       "<div class=\"md-table\"><table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td></td></tr><tr><td>1</td><td>2</td></tr></tbody></table></div>")
        XCTAssertEqual(md("| a |\n|:-:|\n| x | y |"),
                       "<div class=\"md-table\"><table><thead><tr><th>a</th></tr></thead><tbody><tr><td>x</td></tr></tbody></table></div>")
        XCTAssertEqual(md("x | y\n---"), "<div class=\"md-table\"><table><thead><tr><th>x</th><th>y</th></tr></thead><tbody></tbody></table></div>")
        XCTAssertEqual(md("> a\n> > b\n>\n> c"), "<blockquote><p>a</p><blockquote><p>b</p></blockquote><p>c</p></blockquote>")
        XCTAssertEqual(md("a\r\nb\r\rc"), "<p>a<br>b</p><p>c</p>")
    }

    func testInlineMarksStayInsideTheirSpans() {
        // Nothing inside code is marked; a link's text is.
        XCTAssertEqual(md("`**a** https://x.com`"), "<p><code>**a** https://x.com</code></p>")
        XCTAssertEqual(md("[**굵게**](http://x.com)"), "<p><a href=\"http://x.com\" target=\"_blank\" rel=\"noopener noreferrer\"><strong>굵게</strong></a></p>")
        // Trailing punctuation stays out of a bare link; only http(s) links.
        XCTAssertEqual(md("(https://x.com/a), file:///etc/hosts"),
                       "<p>(<a href=\"https://x.com/a\" target=\"_blank\" rel=\"noopener noreferrer\">https://x.com/a</a>), file:///etc/hosts</p>")
        XCTAssertEqual(md("snake_case_name a*b*c 2*3*4 ** 띄움 **"), "<p>snake_case_name a*b*c 2*3*4 <em>* 띄움 *</em></p>")
        XCTAssertEqual(md("한*기울임*한"), "<p>한<em>기울임</em>한</p>")
        XCTAssertEqual(md("**굵게 *기울임* 굵게**"), "<p>**굵게 <em>기울임</em> 굵게**</p>")
    }

    func testRunsCarryTheirMarks() {
        XCTAssertEqual(Markdown.inline("**`a`** b"), [Markdown.Run(text: "a", bold: true, code: true), Markdown.Run(text: " b")])
        XCTAssertEqual(Markdown.inline("~~x~~").first?.strike, true)
        XCTAssertEqual(Markdown.inline("https://1top.si/app").first?.link, URL(string: "https://1top.si/app"))
        XCTAssertEqual(Markdown.inline("a\0b"), [Markdown.Run(text: "ab")])
    }

    // MARK: - The web's HTML

    private func esc(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;").replacingOccurrences(of: "'", with: "&#39;")
    }

    private func html(_ blocks: [Markdown.Block]) -> String {
        blocks.map { block in
            switch block {
            case .paragraph(let lines): "<p>" + lines.map(html).joined(separator: "<br>") + "</p>"
            case .heading(let n, let line): "<p class=\"md-h md-h\(n)\" role=\"heading\" aria-level=\"\(n)\">" + html(line) + "</p>"
            case .list(let list): html(list)
            case .quote(let inner): "<blockquote>" + html(inner) + "</blockquote>"
            case .code(let code): "<pre><code>" + esc(code) + "</code></pre>"
            case .table(let head, let rows):
                "<div class=\"md-table\"><table><thead><tr>" + head.map { "<th>" + html($0) + "</th>" }.joined() + "</tr></thead><tbody>"
                    + rows.map { "<tr>" + $0.map { "<td>" + html($0) + "</td>" }.joined() + "</tr>" }.joined() + "</tbody></table></div>"
            case .rule: "<hr>"
            }
        }.joined()
    }

    private func html(_ list: Markdown.List) -> String {
        let tag = list.ordered ? "ol" : "ul", start = list.ordered && list.start != 1 ? " start=\"\(list.start)\"" : ""
        return "<\(tag)\(start)>" + list.items.map { "<li>" + $0.lines.map(html).joined(separator: "<br>") + $0.lists.map(html).joined() + "</li>" }.joined() + "</\(tag)>"
    }

    /// Runs with one link share its anchor; marks nest strong, em, del, code from the outside in.
    private func html(_ line: Markdown.Line) -> String {
        var out = "", i = 0
        while i < line.count {
            let link = line[i].link
            var group: [Markdown.Run] = []
            while i < line.count && line[i].link == link { group.append(line[i]); i += 1 }
            let body = group.map { r in
                var s = esc(r.text)
                if r.code { s = "<code>\(s)</code>" }
                if r.strike { s = "<del>\(s)</del>" }
                if r.italic { s = "<em>\(s)</em>" }
                if r.bold { s = "<strong>\(s)</strong>" }
                return s
            }.joined()
            out += link.map { "<a href=\"\(esc($0.absoluteString))\" target=\"_blank\" rel=\"noopener noreferrer\">\(body)</a>" } ?? body
        }
        return out
    }
}
