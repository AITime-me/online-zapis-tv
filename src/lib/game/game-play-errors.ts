export class GamePlayUnavailableError extends Error {
  constructor(message = "Игра временно недоступна") {
    super(message);
    this.name = "GamePlayUnavailableError";
  }
}

export class GamePlayGiftPoolEmptyError extends Error {
  constructor(message = "Подарки временно недоступны") {
    super(message);
    this.name = "GamePlayGiftPoolEmptyError";
  }
}
