export const AFTER_FIRST_UNLOCK = "AFTER_FIRST_UNLOCK";

export async function getItemAsync() {
  return null;
}

export async function setItemAsync() {}

export async function deleteItemAsync() {}

const SecureStore = {
  AFTER_FIRST_UNLOCK,
  deleteItemAsync,
  getItemAsync,
  setItemAsync,
};

export default SecureStore;
