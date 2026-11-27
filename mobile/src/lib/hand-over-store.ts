// After a hand-over the phone restarts at language choice like a new install.
// This one-time flag lets that first screen say the phone was cleared, so the
// owner sees it worked instead of a silent jump.
let handedOver = false;

export function markHandedOver(): void {
  handedOver = true;
}

/** True once, on the first screen after a hand-over. */
export function consumeHandedOver(): boolean {
  const was = handedOver;
  handedOver = false;
  return was;
}
