// 테스트가 운영 data/ 폴더를 건드리지 않도록, config.js가 읽기 전에 DATA_DIR을 격리된 스크래치 폴더로 지정한다.
// package.json의 "test" 스크립트가 --import로 이 파일을 가장 먼저 로드한다.
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const testDataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.test-data');
process.env.DATA_DIR = testDataDir;
