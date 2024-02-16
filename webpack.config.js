const path = require('path');

module.exports = {
  mode: 'production', // 빌드 모드: 'production' 또는 'development'
  entry: './src/App.ts', // 진입점(entry point) 설정
  target: 'node', // Node.js 환경에서 실행되는 애플리케이션을 대상으로 함
  output: {
    path: path.resolve(__dirname, '.output/src'), // 빌드된 파일이 저장될 경로
    filename: 'App.js', // 빌드된 파일의 이름
  },
  resolve: {
    extensions: ['.ts', '.js'], // TypeScript 및 JavaScript 파일을 처리할 확장자 목록
  },
  module: {
    rules: [
      {
        test: /\.ts$/, // .ts 파일을 찾아서
        use: 'ts-loader', // ts-loader를 사용하여 컴파일
        exclude: /node_modules/, // node_modules 디렉터리 제외
      },
    ],
  },
};