/** Monotonic generation prevents late requests from restoring a logged-out account. */
export class SessionGeneration {
  private generation = 0;
  private identity: string | null = null;
  activate(identity: string) {
    this.identity = identity;
    return ++this.generation;
  }
  invalidate() {
    this.identity = null;
    ++this.generation;
  }
  capture() {
    return this.generation;
  }
  matches(identity: string, generation: number) {
    return identity === this.identity && generation === this.generation;
  }
}
