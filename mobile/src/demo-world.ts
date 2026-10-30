// Written by scripts/demo-world.mjs from site/src/demo-world.js. Do not edit by hand.
import type {DemoWorld} from './demo-model';
export const WORLD:DemoWorld={
 "rest": 7,
 "computers": [
  {
   "id": "demo-0",
   "name": "MacBook Pro",
   "platform": "Darwin",
   "seed": 23,
   "scale": 1300000,
   "duty": 1,
   "control": true,
   "cores": 12,
   "memory": 36,
   "used": 22.032,
   "cpu": [
    9,
    45
   ],
   "network": {
    "interfaces": [
     "en0"
    ],
    "rx": [
     400000,
     2400000
    ],
    "tx": [
     90000,
     600000
    ]
   },
   "disk": {
    "total": 1099511627776,
    "free": 440234147840,
    "read": 3250585.6,
    "write": 1258291.2
   }
  },
  {
   "id": "demo-1",
   "name": "Mac mini",
   "platform": "Darwin",
   "seed": 61,
   "scale": 300000,
   "duty": 0.2,
   "control": false,
   "cores": 10,
   "memory": 24,
   "used": 15,
   "cpu": [
    12.25,
    48
   ],
   "network": {
    "interfaces": [
     "en0",
     "en1"
    ],
    "rx": [
     131072,
     917504
    ],
    "tx": [
     24576,
     147456
    ]
   },
   "disk": {
    "total": 549755813888,
    "free": 201863462912,
    "read": 838860.8,
    "write": 314572.8
   }
  },
  {
   "id": "demo-2",
   "name": "Workstation",
   "platform": "Windows",
   "seed": 37,
   "scale": 600000,
   "duty": 0.3,
   "control": true,
   "cores": 16,
   "memory": 64,
   "used": 38,
   "cpu": [
    14.35,
    48
   ],
   "network": {
    "interfaces": [
     "Ethernet"
    ],
    "rx": [
     545259.52,
     3816816.64
    ],
    "tx": [
     159744,
     958464
    ]
   },
   "disk": {
    "total": 2199023255552,
    "free": 1209462790553.6,
    "read": 5662310.4,
    "write": 2306867.2
   }
  }
 ],
 "accounts": [
  {
   "key": "dev",
   "id": "demo-claude-4f1c2a",
   "kind": "Claude",
   "email": "dev@example.com",
   "plan": "Max",
   "per": 1.29e-8,
   "reset": 266000,
   "five": {
    "reset": 7400,
    "factor": 6
   },
   "source": "claude_statusline"
  },
  {
   "key": "studio",
   "id": "demo-claude-9b07e3",
   "kind": "Claude",
   "email": "studio@example.com",
   "alias": "Studio",
   "plan": "Pro",
   "per": 5.4e-8,
   "reset": 330000,
   "five": {
    "reset": 14200,
    "factor": 6
   },
   "source": "claude_statusline"
  },
  {
   "key": "ops",
   "id": "demo-codex-c2a957",
   "kind": "Codex",
   "email": "ops@example.com",
   "plan": "Pro",
   "per": 1.3e-7,
   "reset": 300000
  },
  {
   "key": "ml",
   "id": "demo-codex-61d8f0",
   "kind": "Codex",
   "email": "ml@example.com",
   "plan": "Plus",
   "per": 1.8e-8,
   "reset": 220000,
   "stale": 2280,
   "status": "login_required"
  }
 ],
 "sessions": [
  [
   0,
   "s1",
   "Claude",
   "checkout-web",
   "claude-opus-5-5",
   "working",
   "dev",
   30,
   "Orca",
   "Checkout UI",
   "xhigh"
  ],
  [
   0,
   "s2",
   "Codex",
   "billing-service",
   "gpt-6.1-sol",
   "working",
   "ml",
   8,
   "Orca",
   "Billing API",
   "ultra"
  ],
  [
   0,
   "s3",
   "Claude",
   "docs-site",
   "claude-sonnet-5-5",
   "working",
   "studio",
   6,
   "Visual Studio Code",
   "docs",
   "high"
  ],
  [
   0,
   "s4",
   "GLM",
   "data-sync",
   "glm-5.3[1m]",
   "waiting",
   null,
   2,
   "Orca",
   "Nightly sync",
   "high"
  ],
  [
   0,
   "s5",
   "Aside",
   "0",
   "gpt-6.1-sol",
   "working",
   null,
   1.5,
   "Aside",
   "Release notes",
   "medium"
  ],
  [
   0,
   "s6",
   "Codex",
   "api-gateway",
   "gpt-6-astra",
   "idle",
   "ops",
   3,
   "Orca",
   "Gateway",
   "high"
  ],
  [
   0,
   "s7",
   "Claude",
   "mobile-app",
   "claude-haiku-5-5",
   "paused",
   "dev",
   2,
   "Orca",
   "Mobile",
   "low"
  ],
  [
   0,
   "s8",
   "Antigravity",
   "research",
   "gemini-3.5-pro",
   "unknown",
   null,
   0,
   "Cursor",
   "research",
   null
  ],
  [
   0,
   "s9",
   "Claude",
   "design-tokens",
   "claude-sonnet-5-5",
   "waiting",
   "dev",
   4,
   "Ghostty",
   "tokens",
   "medium"
  ],
  [
   0,
   "s10",
   "Gemini",
   "release-bot",
   null,
   "unknown",
   null,
   0,
   "iTerm2",
   "release",
   null
  ],
  [
   0,
   "s11",
   "Codex",
   "data-pipeline",
   "gpt-6-astra",
   "idle",
   "ops",
   2,
   "Terminal",
   "etl",
   "low"
  ],
  [
   0,
   "s12",
   "Claude",
   "onboarding",
   "claude-sonnet-5-5",
   "idle",
   "studio",
   1,
   "Warp",
   "onboard",
   "medium"
  ],
  [
   1,
   "m1",
   "Antigravity",
   "search-index",
   "claude-sonnet-5-5",
   "working",
   null,
   2,
   "Ghostty",
   "indexer",
   "medium"
  ],
  [
   1,
   "m2",
   "Claude",
   "support-replies",
   "claude-haiku-5-5",
   "idle",
   "studio",
   2,
   "Claude",
   "",
   "low"
  ],
  [
   1,
   "m3",
   "Qwen Code",
   "prototype",
   null,
   "unknown",
   null,
   0,
   "Terminal",
   "proto",
   null
  ],
  [
   2,
   "w1",
   "Claude",
   "game-engine",
   "claude-fable-5-1",
   "working",
   "dev",
   14,
   "Windows Terminal",
   "engine",
   "max"
  ],
  [
   2,
   "w2",
   "Codex",
   "infra-scripts",
   "gpt-6.1-sol",
   "waiting",
   "ops",
   3,
   "powershell",
   "infra",
   "medium"
  ],
  [
   2,
   "w3",
   "GLM",
   "analytics",
   "glm-5.3[1m]",
   "working",
   null,
   1.5,
   "Windsurf",
   "analytics",
   "xhigh"
  ],
  [
   2,
   "w4",
   "OpenCode",
   "ui-kit",
   null,
   "unknown",
   null,
   0,
   "Windows Terminal",
   "ui",
   null
  ],
  [
   2,
   "w5",
   "GitHub Copilot",
   "notes",
   null,
   "unknown",
   null,
   0,
   "Visual Studio Code",
   "copilot",
   null
  ],
  [
   2,
   "w6",
   "Codex",
   "research",
   "gpt-6-astra",
   "idle",
   "ml",
   1,
   "ChatGPT",
   "",
   "high"
  ]
 ],
 "children": [
  [
   "s1",
   "reviewer",
   0.25,
   "working"
  ],
  [
   "s1",
   "tester",
   0.1,
   "idle"
  ],
  [
   "s2",
   "migrator",
   0.3,
   "working"
  ]
 ],
 "earlier": [
  [
   0,
   "Claude",
   "dev",
   "claude-opus-5-5",
   "storefront",
   30
  ],
  [
   0,
   "Claude",
   "dev",
   "claude-sonnet-5-5",
   "design-system",
   8
  ],
  [
   0,
   "Claude",
   "studio",
   "claude-sonnet-5-5",
   "docs-site",
   6
  ],
  [
   0,
   "Codex",
   "ops",
   "gpt-6-astra",
   "api-gateway",
   4
  ],
  [
   0,
   "Codex",
   "ml",
   "gpt-6.1-sol",
   "ml-pipeline",
   7
  ],
  [
   0,
   "GLM",
   null,
   "glm-5.3[1m]",
   "data-sync",
   2
  ],
  [
   0,
   "Aside",
   null,
   "gpt-6.1-sol",
   "0",
   1.5
  ],
  [
   1,
   "Claude",
   "studio",
   "claude-haiku-5-5",
   "support-replies",
   2
  ],
  [
   2,
   "Claude",
   "dev",
   "claude-fable-5-1",
   "game-engine",
   14
  ],
  [
   2,
   "Codex",
   "ops",
   "gpt-6.1-sol",
   "infra-scripts",
   3
  ],
  [
   2,
   "Codex",
   "ml",
   "gpt-6-astra",
   "research",
   1
  ]
 ],
 "noReplies": [
  "s6"
 ],
 "conversation": {
  "session": "s1",
  "earlier": [
   {
    "ago": 1500,
    "status": "replied",
    "replied": 60,
    "text": {
     "ko": "지금 어디까지 진행됐나요?",
     "en": "How far along are you?",
     "zh": "现在进展到哪里了？"
    },
    "reply": {
     "ko": "결제 화면의 카드 입력 단계를 새 컴포넌트로 옮겼습니다. 남은 작업은 영수증 화면과 테스트 두 개입니다.",
     "en": "I moved the card entry step of checkout to the new component. The receipt screen and two tests are left.",
     "zh": "已将结账页面的银行卡输入步骤移到新组件，剩下收据页面和两个测试。"
    }
   },
   {
    "ago": 1080,
    "status": "replied",
    "replied": 120,
    "photos": [
     "receipt.png"
    ],
    "text": {
     "ko": "영수증 화면도 이 사진처럼 맞춰 주세요.",
     "en": "Make the receipt screen match this photo too.",
     "zh": "收据页面也请按这张照片调整。"
    },
    "reply": {
     "ko": "사진대로 영수증 화면의 여백과 글자 크기를 맞췄습니다.",
     "en": "I matched the receipt screen's spacing and text sizes to the photo.",
     "zh": "已按照片调整了收据页面的间距和字号。"
    }
   },
   {
    "ago": 420,
    "status": "delivery_unconfirmed",
    "text": {
     "ko": "테스트가 끝나면 알려 주세요.",
     "en": "Let me know when the tests finish.",
     "zh": "测试完成后告诉我。"
    }
   }
  ],
  "script": {
   "text": {
    "ko": "결제 화면 테스트는 어디까지 진행됐나요? 할인 코드 입력란도 확인해 주세요.",
    "en": "How far along are the checkout tests? Please check the discount-code field too.",
    "zh": "结账页面测试进行到哪里了？也请检查一下优惠码输入框。"
   },
   "photo": "demo/checkout.png",
   "steps": [
    {
     "at": 0,
     "status": "queued"
    },
    {
     "at": 2.2,
     "status": "awaiting_reply"
    },
    {
     "at": 4.4,
     "status": "awaiting_reply",
     "activity": "responding"
    },
    {
     "at": 6.6,
     "status": "awaiting_reply",
     "activity": "working"
    },
    {
     "at": 8.8,
     "status": "awaiting_reply",
     "activity": "writing"
    },
    {
     "at": 11,
     "status": "replied"
    }
   ],
   "reply": {
    "ko": "결제 화면 테스트 42개 중 40개가 통과했습니다. 남은 2개는 보내 주신 화면의 할인 코드 입력란 문제라서 지금 고치고 있습니다.",
    "en": "40 of the 42 checkout tests pass. The other 2 are the discount-code field in the screenshot you sent, and I am fixing it now.",
    "zh": "42 个结账测试中有 40 个已通过。剩下 2 个是你发来的截图里的优惠码输入框问题，我正在修复。"
   }
  }
 },
 "operations": [
  {
   "installed_skills": 14,
   "observed_events": 9,
   "goals": [
    {
     "thread_id": "demo-goal-1",
     "runtime": "Codex",
     "status": "active",
     "tokens_used": 18400000,
     "time_used_seconds": 6300,
     "session_connected": true,
     "evidence": "reported"
    }
   ]
  },
  {
   "installed_skills": 8,
   "observed_events": 3,
   "goals": [
    {
     "thread_id": "demo-goal-2",
     "runtime": "Claude Code",
     "status": "complete",
     "tokens_used": 6200000,
     "time_used_seconds": 2700,
     "session_connected": false,
     "evidence": "last_observed"
    }
   ]
  },
  {
   "installed_skills": 11,
   "observed_events": 5,
   "goals": [
    {
     "thread_id": "demo-goal-3",
     "runtime": "Codex",
     "status": "paused",
     "tokens_used": 9100000,
     "time_used_seconds": 4100,
     "session_connected": true,
     "evidence": "reported"
    }
   ]
  }
 ],
 "caps": {
  "s1": [
   "focus",
   "pause",
   "mailbox",
   "message",
   "message_images",
   "terminate",
   "rename"
  ],
  "s2": [
   "focus",
   "pause",
   "mailbox",
   "message",
   "message_images",
   "terminate",
   "rename"
  ],
  "s3": [
   "focus",
   "mailbox",
   "terminate"
  ],
  "s4": [
   "focus",
   "pause",
   "mailbox",
   "terminate",
   "rename"
  ],
  "s5": [
   "focus",
   "pause",
   "prompt",
   "mailbox",
   "message"
  ],
  "s6": [
   "focus",
   "prompt",
   "terminate",
   "rename"
  ],
  "s7": [
   "focus",
   "resume",
   "prompt",
   "mailbox",
   "message",
   "message_images",
   "terminate",
   "rename"
  ],
  "s8": [
   "focus",
   "terminate"
  ],
  "s9": [
   "focus",
   "mailbox",
   "terminate"
  ],
  "s10": [
   "focus",
   "terminate"
  ],
  "s11": [
   "focus",
   "mailbox",
   "terminate"
  ],
  "s12": [
   "focus",
   "mailbox",
   "terminate"
  ],
  "m1": [
   "focus",
   "terminate"
  ],
  "m2": [
   "focus",
   "mailbox",
   "terminate"
  ],
  "m3": [
   "focus",
   "terminate"
  ],
  "w1": [
   "focus",
   "mailbox",
   "terminate"
  ],
  "w2": [
   "focus",
   "mailbox",
   "terminate"
  ],
  "w3": [
   "focus",
   "mailbox",
   "terminate"
  ],
  "w4": [
   "focus",
   "terminate"
  ],
  "w5": [
   "focus",
   "terminate"
  ],
  "w6": [
   "focus",
   "mailbox",
   "terminate"
  ]
 }
};
