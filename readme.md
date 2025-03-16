# es-webdav

나 혼자 쓰려고 만듦

# API

## class `WebdavServer`

webdav 서버를 만듦

### static `methodHandler`
요청 메소드에 응답하는 함수들이 들어있음

### `constructor`
```ts
type WebdavServerConstructorOption = {
    /**
     * node의 http 모듈을 쓸 것인지 http2 모듈을 쓸 것인지 결정
     * 기본값 'http'
     */
    version?: 'http' | 'http2';
    /**
     * webdav 서버가 사용할 포트
     * 기본값 3000
     */
    port?: number;
    /**
     * webdav 서버가 응답을 받았을 때 요청을 처리하기 전 실행할 미들웨어
     * 순차적으로 실행됨
     * 여기서 응답을 끝낼 수도 있음
     */
    middlewares?: RequestHandler[];
    /**
     * 호스트에서 서비스할 경로
     * 이 경로 밑의 파일과 폴더가 webdav으로 서비스됨
     * 기본값 '.'
     */
    rootPath?: string;
    /**
     * webdav 서버에서 사용할 루트 경로
     * `/dav`로 설정하면 '/dav'로 요청을 보내야 rootPath 밑의 폴더와 파일이 뜸
     * 기본값 '/dav'
     */
    davRootPath:? string;
    /**
     * 가상 디렉토리를 사용할 수 있음
     * key: 가상경로, value: 실제경로
     * 예를 들어 `{'/virtual': 'real'}`로 설정할 경우 `/dav/virtual`로 접속하면 'real' 폴더 밑의 폴더와 파일이 뜸
     * 가상 경로는 항상 '/'로 시작해야함
     */
    virtualDirectory?: Record<string, string>;
    /**
     * 파일 잠금을 관리할 객체
     */
    lockManager?: ResourceLockInterface;
    /**
     * 인증을 관리할 객체
     */
    authManager?: AuthInterface;
    /**
     * 계정 당 최대 동시시 연결 횟수
     */
    maxConnection: number;
};

new DB(option: WebdavServerConstructorOption);
```