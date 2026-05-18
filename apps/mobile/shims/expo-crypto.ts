const disabledError = new Error(
  "expo-crypto is disabled in this Expo-safe mobile build."
);

export function randomUUID() {
  return "00000000-0000-4000-8000-000000000000";
}

export function getRandomBytes(byteCount: number) {
  return new Uint8Array(byteCount);
}

export async function getRandomBytesAsync(byteCount: number) {
  return new Uint8Array(byteCount);
}

export async function digestStringAsync() {
  throw disabledError;
}

const Crypto = {
  digestStringAsync,
  getRandomBytes,
  getRandomBytesAsync,
  randomUUID,
};

export default Crypto;
