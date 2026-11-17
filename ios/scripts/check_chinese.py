#!/usr/bin/env python3
"""Lists English texts of L.t(english, korean) calls that the Chinese dictionary does not cover.

Plain texts must be keys of `Chinese.exact`. Texts with interpolation are reduced to a template
("Last \\(x)" -> "Last {}") that must match one of `Chinese.patterns`. A call that gives its own
Chinese (L.t(english, korean, zh: chinese)) covers itself. Exit status 1 on any gap.
Usage: python3 ios/scripts/check_chinese.py [--list]
"""
import pathlib, re, sys

root = pathlib.Path(__file__).resolve().parent.parent / 'OneTop'
swift = '\n'.join(p.read_text() for p in sorted(root.rglob('*.swift')) if p.name != 'Chinese.swift')
dictionary = (root / 'Model' / 'Chinese.swift').read_text()

def own_chinese(text, i):
    """Whether the L.t( call whose first literal ends at i passes its own zh: argument."""
    depth, quoted = 1, False
    while i < len(text) and depth:
        c = text[i]
        if quoted:
            if c == '\\': i += 1
            elif c == '"': quoted = False
        elif c == '"': quoted = True
        elif c == '(': depth += 1
        elif c == ')': depth -= 1
        elif depth == 1 and text.startswith('zh:', i): return True
        i += 1
    return False

def literals(text):
    """The first string literal of every L.t( call, with nested \\(...) kept intact; calls that give their own
    Chinese are left out."""
    out = []
    for m in re.finditer(r'L\.t\(\s*"', text):
        i, depth, buf = m.end(), 0, []
        while i < len(text):
            c = text[i]
            if c == '\\' and text[i + 1] == '(':
                depth += 1; buf.append('\\('); i += 2; continue
            if depth and c == '(':
                depth += 1
            elif depth and c == ')':
                depth -= 1
            elif c == '\\':
                buf.append(text[i:i + 2]); i += 2; continue
            elif c == '"' and not depth:
                break
            buf.append(c); i += 1
        if not own_chinese(text, i + 1):
            out.append(''.join(buf))
    return out

def template(s):
    out, i = [], 0
    while i < len(s):
        if s.startswith('\\(', i):
            depth, i = 1, i + 2
            while depth:
                depth += {'(': 1, ')': -1}.get(s[i], 0); i += 1
            out.append('{}')
        else:
            out.append(s[i]); i += 1
    return ''.join(out)

def unescape(s):
    return s.encode().decode('unicode_escape').encode('latin1').decode('utf-8')

exact = {unescape(k) for k in re.findall(r'^\s*"((?:[^"\\]|\\.)*)":\s*"', dictionary, re.M)}
patterns = re.findall(r'\(try! Regex\(#"(.*?)"#\)', dictionary)  # raw strings, kept as written

# Korean first: the remote subscription's words (paywall B, 4.7.0) wait here for the last translation pass, English
# and Chinese together on every surface, as mobile/test/parity.test.mjs does; the pass empties this list.
PENDING = set()

texts = sorted(set(literals(swift)))
missing = []
for s in texts:
    if '\\(' in s:
        sample = template(s).replace('{}', '7')
        if not any(re.fullmatch(p, sample) for p in patterns) and template(s) not in PENDING:
            missing.append(template(s))
    elif unescape(s) not in exact and unescape(s) not in PENDING:
        missing.append(unescape(s))

if '--list' in sys.argv:
    print('\n'.join(texts))
print(f'{len(texts)} texts, {len(exact)} entries, {len(patterns)} patterns, {len(missing)} missing')
for m in missing:
    print('  missing:', m)
sys.exit(1 if missing else 0)
