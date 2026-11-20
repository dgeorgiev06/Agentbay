export class DrawTurns {
  #holder: object | undefined = undefined;
  #queue: Promise<void> = Promise.resolve();

  isHeldBy(holder: object): boolean {
    return this.#holder === holder;
  }

  take<T>(holder: object, body: () => Promise<T>): Promise<T> {
    const turn = this.#queue.then(async () => {
      this.#holder = holder;
      try {
        return await body();
      } finally {
        this.#holder = undefined;
      }
    });
    this.#queue = turn.then(
      () => undefined,
      () => undefined,
    );
    return turn;
  }
}
