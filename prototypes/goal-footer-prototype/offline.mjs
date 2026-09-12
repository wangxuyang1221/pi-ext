// Preload before Pi or any provider imports. The preview has no network fixture.
globalThis.fetch = async () => { throw new Error("Network is disabled in the goal footer prototype."); };
