"""Public API prices and subscription prices for the monthly value report.

Prices are US dollars per million tokens, checked on PRICES_AS_OF against the sources below. A model that matches
no row has no price: the report leaves it out and counts its tokens apart, never guessing a price.
"""
import re

PRICES_AS_OF = '2026-11-07'
SOURCES = {
    'Claude': 'https://platform.claude.com/docs/en/about-claude/pricing',
    'Codex': 'https://developers.openai.com/api/docs/pricing',
    'GLM': 'https://docs.z.ai/guides/overview/pricing',
}
# (whole name, input, cache read, cache write, output). Cache writes use the shortest cache (5 minutes at Anthropic,
# 30 minutes at OpenAI) when a log does not say which, so the value never reads high. A pattern names the whole model
# (after normalize drops a date or a context suffix): a new variant (claude-opus-5-99, glm-5.30) has no price until
# it is added here.
MODELS = [
    (r'claude-fable-5-1', 10, .25, 12.5, 50),
    (r'claude-mythos-5-1', 10, .25, 12.5, 50),
    (r'claude-(fable|mythos)-5', 10, 1, 12.5, 50),
    (r'claude-opus-5-5', 4, .20, 5, 20),
    (r'claude-opus-(5|4-8|4-7|4-6|4-5)', 5, .50, 6.25, 25),
    (r'claude-opus-4(-1)?', 15, 1.5, 18.75, 75),
    (r'claude-sonnet-5-5', 2, .10, 2.5, 10),
    (r'claude-sonnet-5', 2, .20, 2.5, 10),
    (r'claude-sonnet-4(-6|-5)?', 3, .30, 3.75, 15),
    (r'claude-haiku-5-5', .10, .01, .125, .50),
    (r'claude-haiku-4-5', 1, .10, 1.25, 5),
    (r'gpt-6-astra', 10, 1, 12.5, 50),
    (r'gpt-6\.1-sol', 2, .10, 2.5, 10),
    (r'gpt-5\.6-terra', 2, .20, 2.5, 12),
    (r'gpt-6-luna', .10, .01, .125, .50),
    (r'gpt-5\.3-codex', 1.75, .175, 0, 14),
    (r'glm-5\.3-flash', .15, .03, 0, .50),
    (r'glm-5\.3', 1.40, .26, 0, 4.40),
]
_COMPILED = [(re.compile(m[0]), m[1:]) for m in MODELS]


def normalize(model):
    """Lower case, without a provider prefix, a context suffix like [1m] or a date suffix."""
    name = str(model or '').strip().lower()
    name = name.split('/')[-1]
    name = re.sub(r'\[[^\]]*\]$', '', name)
    name = re.sub(r'-20\d{6}$', '', name)
    return name


def price(model):
    """(input, cache read, cache write, output) per million tokens, or None when the model has no known price."""
    name = normalize(model)
    if not name or name == 'unknown':
        return None
    for pattern, rest in _COMPILED:
        if pattern.fullmatch(name):
            return tuple(rest)
    return None


def value(model, tokens):
    """Dollars for [fresh input, cache read, cache write, output] tokens, or None without a price."""
    p = price(model)
    if p is None:
        return None
    return sum(n * rate for n, rate in zip(tokens, p)) / 1e6


# What a month of each plan costs, by tool and the account's own plan words. None is a plan whose price is not
# certain (ChatGPT Pro comes at $100, $200 or $500; team seats vary): the user picks it.
def plan(kind, plan_name='', tier=''):
    """(plan, label, price or None) for an account, from what the provider reports."""
    p = str(plan_name or '').strip().lower()
    t = str(tier or '').lower()
    if kind == 'Claude':
        if 'max_20x' in t:
            return 'max20x', 'Claude Max 20x', 200
        if 'max' in p or '_claude_max' in t:
            return 'max', 'Claude Max', 100
        if p == 'pro':
            return 'pro', 'Claude Pro', 20
        if p in ('ultra',):
            return 'ultra', 'Claude Ultra', 200
        if p in ('free',):
            return 'free', 'Claude Free', 0
        return (p or 'unknown'), ('Claude ' + p.title()).strip() if p else 'Claude', None
    if kind == 'Codex':
        known = {'free': ('ChatGPT Free', 0), 'go': ('ChatGPT Go', 8), 'plus': ('ChatGPT Plus', 20)}
        if p in known:
            return p, known[p][0], known[p][1]
        return (p or 'unknown'), ('ChatGPT ' + p.title()).strip() if p else 'ChatGPT', None
    if kind == 'GLM':
        if p == 'lite':
            return 'lite', 'GLM Lite', 18
        return (p or 'unknown'), ('GLM ' + p.title()).strip() if p else 'GLM', None
    label = {'Antigravity': 'Agy'}.get(kind, kind or '')
    return (p or 'unknown'), (label + ' ' + p.title()).strip() if p else label, None
