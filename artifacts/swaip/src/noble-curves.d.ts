declare module '@noble/curves/ed25519' {
  export const ed25519: {
    sign(msg: Uint8Array, privKey: Uint8Array): Uint8Array;
    verify(sig: Uint8Array, msg: Uint8Array, pubKey: Uint8Array): boolean;
    getPublicKey(privKey: Uint8Array): Uint8Array;
    utils: {
      randomPrivateKey(): Uint8Array;
    };
  };
}
