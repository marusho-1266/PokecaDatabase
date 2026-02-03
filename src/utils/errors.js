/**
 * カスタムエラークラス
 */

export class InvalidParameterError extends Error {
  constructor(message = '無効なパラメータです') {
    super(message);
    this.name = 'InvalidParameterError';
    this.statusCode = 400;
  }
}

export class NotFoundError extends Error {
  constructor(message = 'リソースが見つかりませんでした') {
    super(message);
    this.name = 'NotFoundError';
    this.statusCode = 404;
  }
}

export class TimeoutError extends Error {
  constructor(message = 'タイムアウトが発生しました') {
    super(message);
    this.name = 'TimeoutError';
    this.statusCode = 408;
  }
}

export class NetworkError extends Error {
  constructor(message = 'ネットワークエラーが発生しました') {
    super(message);
    this.name = 'NetworkError';
    this.statusCode = 503;
  }
}

export class ServerError extends Error {
  constructor(message = 'サーバーエラーが発生しました') {
    super(message);
    this.name = 'ServerError';
    this.statusCode = 500;
  }
}
