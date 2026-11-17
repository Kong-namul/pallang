# pallang

곤충·거미 웹 모션 예제 모음 (CSS / JS / Canvas / SVG / three.js).

- `index.html` — 탭 갤러리. 로컬에서 보려면 폴더에서 `python3 -m http.server 5178` 실행 후 http://localhost:5178
- `gallery-data.js` — 갤러리에 보이는 카드와 레퍼런스 사이트 목록
- `assets/` — 곤충별 그림·공통 동작 코드
- `examples/<곤충>/` — 상황별 예제. 파일 하나가 예제 하나

## 상태

갤러리에 들어간 탭: 나비, 잠자리, 반딧불이, 애벌레, 벌.

`examples/beetle`, `examples/spider`, `examples/ladybug`, `examples/mantis` 는 작업 중이라 아직 확인하지 않았고 갤러리에도 없어요.

## 참고한 것

나비 날개 움직임은 [ykob/sketch-threejs](https://github.com/ykob/sketch-threejs) 의 butterfly 셰이더(MIT) 방식을 따랐어요. 그 밖의 레퍼런스는 갤러리 각 탭 아래쪽에 있어요.
