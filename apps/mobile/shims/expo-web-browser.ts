export function maybeCompleteAuthSession() {}

export async function openAuthSessionAsync() {
  return {
    type: "cancel",
    url: null,
  };
}

const WebBrowser = {
  maybeCompleteAuthSession,
  openAuthSessionAsync,
};

export default WebBrowser;
