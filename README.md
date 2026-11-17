# pallang

곤충·거미 웹 모션 예제 모음 (CSS / JS / Canvas / SVG / three.js).

갤러리: https://kong-namul.github.io/pallang/

- `index.html` — 탭 갤러리. 로컬에서 보려면 폴더에서 `python3 -m http.server 5178` 실행 후 http://localhost:5178
- `gallery-data.js` — 갤러리에 보이는 카드와 레퍼런스 사이트 목록
- `assets/` — 곤충별 그림·공통 동작 코드
- `examples/<곤충>/` — 상황별 예제. 파일 하나가 예제 하나

## 상태

갤러리에 들어간 탭(15개): 나비, 나방, 잠자리, 벌, 파리·모기, 반딧불이, 풍뎅이, 무당벌레, 메뚜기, 매미, 사마귀, 개미, 소금쟁이, 애벌레, 거미. 처음 계획한 예제는 모두 만들었어요.

## 배포

main 에 push 하면 GitHub Actions(`.github/workflows/pages.yml`)가 `node scripts/build-site.mjs` 로 `dist/` 를 만들어 GitHub Pages 에 올려요.

### Vercel 로 올리고 싶을 때

`vercel.json` 이 들어 있어서 Vercel 에서 이 레포를 가져오기(Import)만 하면 돼요. 빌드는 `node scripts/build-site.mjs` 가 `dist/` 를 만들어요 (갤러리 첫 페이지에 `<!doctype html>` 을 붙이고 나머지 파일은 그대로 복사). main 에 push 할 때마다 자동으로 다시 배포돼요.

## 다음에 이어서 할 것 (2026-11-17 기준)

1. 손대면 반응하는 예제들을 실제로 눌러 보며 확인. 지금은 오류 없이 도는 것과 코드로 흉내 낸 터치까지만 확인했어요.

예제를 추가하는 방법: `examples/<곤충>/NN-이름.html` 을 만들고, `gallery-data.js` 의 `EX` 목록 맨 끝(`/*__MORE_EX__*/` 표시 바로 위)에 카드 한 줄을 넣으면 갤러리에 나와요.

## 참고한 것

나비 날개 움직임은 [ykob/sketch-threejs](https://github.com/ykob/sketch-threejs) 의 butterfly 셰이더(MIT) 방식을 따랐어요. 그 밖의 레퍼런스는 갤러리 각 탭 아래쪽에 있어요.
