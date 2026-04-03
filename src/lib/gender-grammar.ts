type UserGender = "male" | "female" | "other" | null | undefined;

export function getGenderGrammar(gender: UserGender) {
  switch (gender) {
    case "male":
      return {
        subject: "he",
        be: "is",
        contractedBe: "he's",
      };
    case "female":
      return {
        subject: "she",
        be: "is",
        contractedBe: "she's",
      };
    case "other":
    default:
      return {
        subject: "they",
        be: "are",
        contractedBe: "they're",
      };
  }
}
