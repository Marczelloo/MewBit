const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let createStore;
let memoSelect;

test.before(async () => {
  ({ createStore, memoSelect } = await import(
    pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/hudStore.js")).href
  ));
});

test("the store hands back what was set and tells every subscriber", () => {
  const store = createStore({ score: 0 });
  const seen = [];
  store.subscribe(() => seen.push("a"));
  store.subscribe(() => seen.push("b"));
  const next = { score: 5 };
  store.set(next);
  assert.equal(store.get(), next);
  assert.deepEqual(seen, ["a", "b"]);
});

test("setting the same value again wakes nobody", () => {
  const value = { score: 1 };
  const store = createStore(value);
  let calls = 0;
  store.subscribe(() => { calls += 1; });
  store.set(value);
  assert.equal(calls, 0);
});

test("an unsubscribed listener hears nothing more, and may unsubscribe while being called", () => {
  const store = createStore(0);
  let calls = 0;
  const stop = store.subscribe(() => { calls += 1; stop(); });
  let other = 0;
  store.subscribe(() => { other += 1; });
  store.set(1);
  store.set(2);
  assert.equal(calls, 1);
  assert.equal(other, 2);
});

test("memoSelect builds once per input and again for a new one", () => {
  let built = 0;
  const select = memoSelect((state) => { built += 1; return { double: state.n * 2 }; });
  const state = { n: 2 };
  const first = select(state);
  assert.equal(select(state), first, "same input, same object");
  assert.equal(built, 1);
  const second = select({ n: 3 });
  assert.notEqual(second, first);
  assert.equal(second.double, 6);
  assert.equal(built, 2);
});

test("memoSelect keeps an undefined input apart from nothing seen yet", () => {
  let built = 0;
  const select = memoSelect(() => { built += 1; return built; });
  select(undefined);
  select(undefined);
  assert.equal(built, 1);
});
