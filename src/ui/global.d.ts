import type { CardnewsApi } from "../domain/cardnews-api";

declare global {
  interface Window {
    cardnews: CardnewsApi;
  }
}

export {};
