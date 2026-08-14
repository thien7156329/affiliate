import fs from 'fs';
import path from 'path';

function removeLock(dir) {
  if (fs.existsSync(dir)) {
    const lockPath = path.join(dir, 'SingletonLock');
    if (fs.existsSync(lockPath)) {
      console.log('Removing lock at', lockPath);
      try {
        fs.unlinkSync(lockPath);
        console.log('Successfully deleted lock');
      } catch (err) {
        console.error('Failed to delete lock:', err.message);
      }
    }
  }
}

removeLock('/tmp/puppeteer-crawl');
removeLock('/tmp/puppeteer-test-shopee');
