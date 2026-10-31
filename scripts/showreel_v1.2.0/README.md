# 1top 쇼릴 v1.2.0

랜딩 페이지(https://1top.si)에 넣을 약 35초짜리 소개 영상을 만드는 스크립트입니다. 장면은 화면에 보이는 번호와 이름으로 부릅니다: 시작, 01 / GAUGES, 02 / SESSIONS, 03 / CONVERSATION, 04 / MENU BAR · TRAY, 05 / WEEKLY LIMITS, 끝 카드. v1.0.0에서 05 / EVERYWHERE(휴대폰·웹)와 06 / LANGUAGE(언어 버튼)를 뺐습니다. 언어 전환은 어느 앱에나 있는 기본 기능이라 소개하지 않습니다. 03 / CONVERSATION은 보내기 확인창이 없어진 화면(`1d409e1`)으로 찍었고, 04 / MENU BAR · TRAY의 메뉴 원본과 트레이 정지 화면은 `3e41fe5` 빌드로 다시 찍었습니다.

녹화와 프레임 추출은 v1.0.0의 `take.py`, `frames.py`를 그대로 쓰고, 그 결과(`build/showreel_v1.0.0/frames/`)에서 합성합니다. 이 폴더에는 합성 페이지와 `render.py`만 있습니다.

- **데모 데이터**: `scripts/demo-state.mjs`가 만든 값입니다. 프로젝트와 계정은 지어낸 것이고, 사용량은 실제 사용 모양(몰림과 휴식)을 따릅니다.
- **녹화 빌드**: `scripts/showcase_v7.0.0/prepare_capture.py`가 만든 `build/showcase_v7.0.0/`을 그대로 씁니다(기준 커밋 `3e41fe5`). 이 빌드는 랜딩 v7.0.0 영상과 같은 장면 시간표를 씁니다.
- **데모 시각**: 랜딩 영상, 웹, 휴대폰과 같은 `demoNow` 1800000000에 데모를 멈춰 두고 찍습니다. 그래서 모든 장면의 계정 한도가 61% · 33% · 71% · 18%로 같습니다.
- **규격**: 1920×1080, 30fps, 소리 없음, 35.4초(1,062프레임). MP4(H.264)와 WebM(VP9), 포스터 JPEG를 언어마다 하나씩 만듭니다.

| 파일 | 내용 |
| --- | --- |
| `reel/` | 합성 페이지입니다. `reel.js`가 시간 t를 받아 모든 요소의 위치·투명도·카메라와 보여 줄 녹화 프레임을 정합니다. |
| `render.py stills\|film\|encode` | 페이지를 Chrome으로 열어 프레임마다 찍습니다. `film`은 무손실 원본(`build/showreel_v1.2.0/master-<언어>.mkv`)을 만들고, `encode`는 웹용 MP4·WebM·포스터(`site/public/media/v7.0.0/showreel-v1.2.0-<언어>.*`)를 만듭니다. |
| v1.0.0의 `take.py`, `frames.py`, `phones.py` | 녹화와 프레임 추출입니다. v1.2.0은 휴대폰 화면을 쓰지 않으므로 `phones.py`는 필요 없습니다. 트레이 정지 화면은 `scripts/showcase_v7.0.0/stills.py tray --out=$PWD/build/showreel_v1.0.0/stills --lang=ko`로 만듭니다. |

## 다시 만드는 방법

필요한 것은 Xcode, Node, `ffmpeg`, Python의 Pillow와 Playwright, 터미널 앱의 화면 기록 권한입니다.

```bash
python3 scripts/showcase_v7.0.0/prepare_capture.py 3e41fe5           # 녹화 빌드(한 번만)
for scene in dashboard conversation accounts menu; do
  for lang in ko en zh; do python3 scripts/showreel_v1.0.0/take.py $scene --lang $lang; done
done
python3 scripts/showreel_v1.0.0/frames.py
python3 scripts/showreel_v1.2.0/render.py film --lang ko
python3 scripts/showreel_v1.2.0/render.py encode --lang ko
```

- 지금은 한국어판만 만듭니다. 영어·중국어판은 한국어판이 확정된 뒤 `--lang en`, `--lang zh`로 한 번에 만듭니다. 세 언어를 함께 돌릴 때는 언어마다 따로 실행합니다(셋을 동시에 돌리면 마지막 프레임 근처에서 멈춘 적이 있습니다).
- 이미 있는 녹화본과 결과 파일은 지킵니다. 다시 만들 때는 `take.py`와 `render.py encode`에 `--replace`를 붙입니다.
- `render.py`는 언어마다 다른 포트(18871~18873)를 씁니다.
- 확인용 정지 화면은 `render.py stills 2.4 6.5 30 --lang ko`처럼 찍으면 `build/showreel_v1.2.0/check/`에 남습니다.

## 장면

| 시간 | 장면 | 재료 | 내용 |
| --- | --- | --- | --- |
| 0.0–3.2초 | 시작 | 브랜드 마크, 워드마크 | 큰 로고와 랜딩 슬로건 '흩어진 AI 작업, 한눈에 보이게.'. 첫 프레임은 끝 카드의 마지막 프레임과 같아서 반복 재생이 끊기지 않습니다. |
| 3.2–9.4초 | 01 / GAUGES · 토큰 속도계 | `dashboard` 0.2–4.4초 | 창 전체에서 속도계로 다가가고, 기간이 1시간에서 24시간으로 바뀐 뒤 토큰 흐름의 몰림과 휴식을 보여 줍니다. |
| 9.4–14.2초 | 02 / SESSIONS · 세션마다 상태와 계정 | `dashboard` 10.2–15.4초 | 작업 중 세션들에서 작업 중 아님(대기·확인 필요·일시정지) 세션들로 내려갑니다. |
| 14.2–22.2초 | 03 / CONVERSATION · 세션과 바로 대화 | `conversation` 1.0–21.4초 | 사진을 붙인 메시지를 확인창 없이 보내고 ✓ 보냄 → 점 → Claude Code 답까지를 2~3배속으로 보여 줍니다. 칩이 묻고 → 작업하고 → 답해요를 따라갑니다. |
| 22.2–27.0초 | 04 / MENU BAR · TRAY · 메뉴 막대에도, 트레이에도 같은 패널 | `menu` 3.0–9.6초, 트레이 정지 화면 | macOS 메뉴 막대 패널과 Windows 트레이 퀵뷰를 나란히 놓습니다. 맥 패널이 10분 → 24시간 → 트레이와 같은 1시간으로 바뀌면 두 패널의 숫자가 같아집니다. |
| 27.0–31.2초 | 05 / WEEKLY LIMITS · 계정별 주간 한도 | `accounts` 4.6–9.4초 | 계정 카드 네 개에서 위 두 개로 다가갑니다. |
| 31.2–35.4초 | 끝 카드 | | 큰 로고, 1top.si, 다운로드(macOS · Windows · Android). 마지막 0.7초에 주소와 버튼이 사라지고 로고만 남습니다. |

## 모션

랜딩의 모션 참고 규칙을 따릅니다. motion-reference.takayustudio.jp에서는 아이디어와 이징만 가져오고 코드는 쓰지 않았습니다.
- 장면 전환: 아래에서 위로 여는 클립 리빌(easeOutQuart, 0.8초). 들어오는 장면은 살짝 확대된 상태에서 자리를 잡고, 나가는 장면은 조금 작아지며 어두워집니다.
- 제목: 줄마다 마스크 위로 올라옵니다(easeOutQuart, 줄마다 95ms).
- 번호 라벨(`01 / GAUGES`): 왼쪽부터 글자가 풀립니다. 바뀌는 글자는 프레임 번호로 정해서 렌더할 때마다 같습니다.
- 카메라: 창의 한 영역을 화면의 한 상자에 맞추고, 열쇠 사이를 easeInOutCubic으로 옮깁니다. 배율은 로그 척도로 보간합니다.

## 렌더링에서 바꾼 점

- 합성 페이지의 모든 이미지는 그릴 때 디코딩합니다(`decoding="sync"`). 프레임마다 화면에 보이는 정지 이미지를 다시 디코딩하고, 요청이 실패하면 다시 받습니다. 끝내 못 받으면 렌더가 오류로 멈춥니다. 빈칸이 있는 프레임은 나가지 않습니다.
- Chrome은 `--disable-checker-imaging --run-all-compositor-stages-before-draw`로 띄웁니다. 바쁠 때도 조용할 때와 같은 프레임이 나옵니다.
- 로컬 파일 서버의 접속 대기열을 256으로 늘렸습니다. 기본값 5에서는 페이지가 이미지를 한꺼번에 불러올 때 요청 하나가 끊겨 휴대폰 화면이 비는 일이 있었습니다.
