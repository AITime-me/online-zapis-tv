/**
 * Проверка POST /api/game/play через HTTP.
 * Запуск: node scripts/test-game-play-api.mjs [baseUrl]
 */
const baseUrl = process.argv[2] ?? "http://localhost:3000";

async function play(payload) {
  const res = await fetch(`${baseUrl}/api/game/play`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  return { status: res.status, data };
}

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

async function main() {
  console.log(`Base URL: ${baseUrl}\n`);

  const s1 = await play({
    gameDirection: "faceCare",
    skinNeed: "hydration",
    resultType: "skinQuality",
    premiumLevel: 0,
  });
  console.log("=== Сценарий 1: faceCare, premiumLevel=0 ===");
  console.log(JSON.stringify(s1.data, null, 2));
  assert(s1.status === 200 && s1.data.ok === true, "HTTP 200, ok=true");
  assert(s1.data.playId, "playId присутствует");
  assert(s1.data.gift?.name, `gift.name = ${s1.data.gift?.name}`);
  assert(
    s1.data.gift.name !== "Формула сияния",
    "Формула сияния не выпала при premiumLevel=0",
  );

  const s3 = await play({
    gameDirection: "faceCare",
    skinNeed: "hydration",
    resultType: "skinQuality",
    premiumLevel: 3,
  });
  console.log("\n=== Сценарий 3: faceCare, premiumLevel=3 ===");
  console.log(JSON.stringify(s3.data, null, 2));
  assert(s3.status === 200 && s3.data.ok === true, "HTTP 200, ok=true");
  assert(
    s3.data.gift?.name !== "Формула сияния",
    "Формула сияния недоступна при faceCare + premiumLevel=3",
  );

  console.log("\n=== Сценарий 2: recovery, premiumLevel=3 (до 30 попыток) ===");
  let formulaHit = false;
  const giftsSeen = new Set();
  for (let i = 0; i < 30; i += 1) {
    const s2 = await play({
      gameDirection: "recovery",
      skinNeed: "restoration",
      resultType: "recovery",
      premiumLevel: 3,
    });
    if (s2.data.gift?.name) giftsSeen.add(s2.data.gift.name);
    if (s2.data.gift?.name === "Формула сияния") {
      formulaHit = true;
      console.log(`Попытка ${i + 1}:`, JSON.stringify(s2.data, null, 2));
      break;
    }
  }
  console.log("Выпавшие подарки за попытки:", [...giftsSeen]);
  assert(formulaHit, "Формула сияния может выпасть при recovery + premiumLevel=3");

  console.log("\n=== Все API-проверки пройдены ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
