import { Readable } from 'stream';
import {
  createPool,
  Pool,
  Options as PoolOptions,
  Factory as PoolFactory,
} from 'generic-pool';
import puppeteer, { Browser, Page, PDFOptions } from 'puppeteer';

interface PageInstance {
  browser: Browser;
  page: Page;
}

class PageFactory implements PoolFactory<PageInstance> {
  async create(): Promise<PageInstance> {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    return {
      browser,
      page: await browser.newPage(),
    };
  }

  async destroy(client: PageInstance): Promise<void> {
    try {
      if (client.browser.isConnected()) {
        await client.browser.close();
      }
    } catch {
      return;
    }
  }

  async validate(client: PageInstance): Promise<boolean> {
    try {
      return !!(await client.page.metrics());
    } catch {
      return false;
    }
  }
}

export class PdfGenerator {
  protected pagesPool: Pool<PageInstance>;

  /**
   * @param poolConfig https://github.com/coopernurse/node-pool/blob/1c5cb79dcbea27c4b1839bd75bfc41274adb8b94/lib/PoolOptions.js#L5
   */
  constructor(poolConfig: PoolOptions = { min: 1, max: 10 }) {
    this.pagesPool = createPool(new PageFactory(), {
      testOnReturn: true, // Should the pool validate resources before returning them to the pool
      evictionRunIntervalMillis: 5000,
      ...poolConfig,
      autostart: true,
    });
  }

  async stop() {
    await this.pagesPool.drain();
    await this.pagesPool.clear();
  }

  async awaitPool() {
    return this.pagesPool.ready();
  }

  generatePDF(htmlOrUrl: string | URL): Promise<Buffer>;
  generatePDF(
    htmlOrUrl: string | URL,
    stream: undefined,
    pdfOptions?: PDFOptions,
  ): Promise<Buffer>;
  generatePDF(
    htmlOrUrl: string | URL,
    stream: false,
    pdfOptions?: PDFOptions,
  ): Promise<Buffer>;
  generatePDF(
    htmlOrUrl: string | URL,
    stream: true,
    pdfOptions?: PDFOptions,
  ): Promise<Readable>;
  public async generatePDF(
    htmlOrUrl: string | URL,
    stream = false,
    pdfOptions?: PDFOptions,
  ): Promise<Readable | Buffer> {
    const page = await this.pagesPool.acquire();

    try {
      if (htmlOrUrl instanceof URL) {
        await page.page.goto(htmlOrUrl.toString(), {
          waitUntil: 'networkidle0',
        });
      } else {
        await page.page.setContent(htmlOrUrl, { waitUntil: 'networkidle0' });
      }

      //To reflect CSS used for screens instead of print
      await page.page.emulateMediaType('print');
    } catch (e) {
      await this.pagesPool.release(page);
      throw e;
    }

    const options: PDFOptions = pdfOptions || {
      margin: { top: '100px', right: '50px', bottom: '100px', left: '50px' },
      format: 'A4',
    };

    if (!stream) {
      try {
        const res = await page.page.pdf(options);
        await this.pagesPool.release(page);
        return res;
      } catch (e) {
        await this.pagesPool.destroy(page);
        throw e;
      }
    }

    try {
      let released = false;
      return (await page.page.createPDFStream(options))
        .once('error', () => {
          if (!released) {
            released = true;
            this.pagesPool.destroy(page).catch(() => undefined);
          }
        })
        .once('close', () => {
          if (!released) {
            released = true;
            this.pagesPool.release(page).catch(() => undefined);
          }
        })
        .once('end', () => {
          if (!released) {
            released = true;
            this.pagesPool.release(page).catch(() => undefined);
          }
        });
    } catch (e) {
      await this.pagesPool.destroy(page).catch(() => undefined);
      throw e;
    }
  }
}
