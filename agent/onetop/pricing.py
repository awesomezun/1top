"""Public API prices and subscription prices for the monthly value report.

Prices are US dollars per million tokens, checked on PRICES_AS_OF against the sources below. A model that matches
no row has no price: the report leaves it out and counts its tokens apart, never guessing a price.
"""
import re
from . import _rust_bridge

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


def _py_normalize(model):
    """Lower case, without a provider prefix, a context suffix like [1m] or a date suffix."""
    name = str(model or '').strip().lower()
    name = name.split('/')[-1]
    name = re.sub(r'\[[^\]]*\]$', '', name)
    name = re.sub(r'-20\d{6}$', '', name)
    return name


def normalize(model):
    m = _rust_bridge.mode()
    if m == 'old':
        return _py_normalize(model)
    arg = '' if not model else str(model)
    if m == 'new':
        return _rust_bridge.native.pricing_normalize(arg)
    return _rust_bridge.shadow_check('pricing.normalize', _py_normalize(model), _rust_bridge.native.pricing_normalize(arg))


def _py_price(model):
    """(input, cache read, cache write, output) per million tokens, or None when the model has no known price."""
    name = _py_normalize(model)
    if not name or name == 'unknown':
        return None
    for pattern, rest in _COMPILED:
        if pattern.fullmatch(name):
            return tuple(rest)
    return None


def price(model):
    m = _rust_bridge.mode()
    if m == 'old':
        return _py_price(model)
    arg = '' if not model else str(model)
    if m == 'new':
        return _rust_bridge.native.pricing_price(arg)
    return _rust_bridge.shadow_check('pricing.price', _py_price(model), _rust_bridge.native.pricing_price(arg))


def _py_value(model, tokens):
    """Dollars for [fresh input, cache read, cache write, output] tokens, or None without a price."""
    p = _py_price(model)
    if p is None:
        return None
    return sum(n * rate for n, rate in zip(tokens, p)) / 1e6


def value(model, tokens):
    m = _rust_bridge.mode()
    if m == 'old':
        return _py_value(model, tokens)
    arg = '' if not model else str(model)
    toks = [float(x) for x in tokens]
    if m == 'new':
        return _rust_bridge.native.pricing_value(arg, toks)
    return _rust_bridge.shadow_check('pricing.value', _py_value(model, toks), _rust_bridge.native.pricing_value(arg, toks))


# What a month of each plan costs, by tool and the account's own plan words. None is a plan whose price is not
# certain (ChatGPT Pro comes at $100, $200 or $500; team seats vary): the user picks it.
def _py_plan(kind, plan_name='', tier=''):
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


def plan(kind, plan_name='', tier=''):
    m = _rust_bridge.mode()
    if m == 'old':
        return _py_plan(kind, plan_name, tier)
    k = str(kind or '')
    pn = str(plan_name or '')
    tr = str(tier or '')
    if m == 'new':
        return _rust_bridge.native.pricing_plan(k, pn, tr)
    return _rust_bridge.shadow_check('pricing.plan', _py_plan(kind, plan_name, tier), _rust_bridge.native.pricing_plan(k, pn, tr))
