import {afterAll, afterEach, beforeEach, describe, expect, jest, test} from '@jest/globals';
import { PdfGenerator } from './index';
import {Readable, Stream} from "stream";
import {createPool, Factory as PoolFactory} from "generic-pool";

const readStream = async (stream: Readable): Promise<Buffer> => {
    const chunks: Buffer[] = [];
    for await (let chunk of stream) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

let getMockedPool = (poolFactory?: Partial<PoolFactory<any>>) => {
    const getDefaultStreamCallback = () => jest.fn(() => {
        const stream = new Stream.Readable({
            read: () => {},
        });
        setTimeout(async () => {
            stream.push(Buffer.from("abc", "utf-8"));
            await stream.destroy();
        }, 50);
        return stream;
    });

    const getDefaultBufferCallback = () => jest.fn(() => {
        return new Promise(resolve => setTimeout(() => resolve(Buffer.from("abc", "utf-8")), 50));
    });

    const mockedPage = {
        page: {
            setContent: jest.fn(() => {}) as () => any,
            emulateMediaType: jest.fn(() => {}) as () => any,
            pdf: getDefaultBufferCallback() as () => any,
            createPDFStream: getDefaultStreamCallback() as () => any,
        }
    };

    return {
        setPdfMethod: (fn?: () => any) => {
            mockedPage.page.pdf = fn || getDefaultBufferCallback();
        },
        setSetContentMethod: (fn?: () => any) => {
            mockedPage.page.setContent = fn || jest.fn(() => {});
        },
        setCreatePDFStreamMethod: (fn?: () => any) => {
            mockedPage.page.createPDFStream = fn || getDefaultStreamCallback();
        },
        mockedPage,
        pool: createPool({
            async create(): Promise<any> {
                await new Promise(resolve => setTimeout(resolve, 50));
                return Promise.resolve(mockedPage);
            },
            destroy(): Promise<void> {
                return Promise.resolve();
            },
            validate(): Promise<boolean> {
                return Promise.resolve(true);
            },
            ...poolFactory,
        }, {
            autostart: true,
            testOnBorrow: true,
        }),
    };
}

describe('PdfGenerator module', () => {
    describe('Positive scenario', () => {
        let generator = new PdfGenerator();

        beforeEach(async () => {
            generator = new PdfGenerator({
                max: 1,
                min: 1,
            });
            await generator.awaitPool();
        });

        afterEach(async () => {
            await generator.stop();
        })

        test('Render pdf from html test', async () => {
            await generator.generatePDF('<html lang="html">Hello World!</html>');
        });

        test('Render pdf from html', async () => {
            const pdf = await generator.generatePDF('<html lang="html">Hello World!</html>');
            const pdfFromStream = await readStream(
                await generator.generatePDF('<html lang="html">Hello World!</html>', true),
            );

            expect(pdfFromStream.length).toBe(pdf.length);
        }, 60000);

        test('Render pdf from url', async () => {
            const pdf = await generator.generatePDF(new URL('https://github.com/frimuchkov/hpdf'));
            expect(pdf.length).toBeGreaterThan(100);
        }, 60000);

        test('PDF have to be rendered in FIFO', async () => {
            const timestamps: number[] = [];
            await Promise.all((new Array(3).fill(0).map(async (_, i) => {
                await new Promise(resolve => setTimeout(resolve, i * 50));
                await generator.generatePDF('<html lang="html">Hello World!</html>');
                timestamps.push(Date.now());
            })));

            expect([...timestamps].sort()).toStrictEqual(timestamps);
        }, 60000);

        test('Stream have to lock and release resource', async () => {
            let bufferTimestamp = 0;
            let streamTimestamp = 0;

            const pdfStream = generator.generatePDF('<html lang="html">Hello World!</html>', true);
            const pdfBuffer = generator.generatePDF('<html lang="html">Hello World!</html>');

            await Promise.all([(async () => {
                await readStream(await pdfStream);
                streamTimestamp = Date.now();
            })(), pdfBuffer.then(() => {
                bufferTimestamp = Date.now();
            })]);

            expect(bufferTimestamp - streamTimestamp).toBeGreaterThan(100)
        }, 60000);
    });

    describe('Negative scenario', () => {
        let generator = new PdfGenerator();

        beforeEach(async () => {
            generator = new PdfGenerator({
                max: 1,
                min: 1,
            });
            await generator.awaitPool();
        });

        afterEach(async () => {
            await generator.stop();
        });

        test('Pool have to destroy invalid instance and acquire the new one', async () => {
            const destroyPool = jest.fn(() => {});
            const validatePool = jest.fn(() => true);
            const pagesPool = getMockedPool({
                destroy(): Promise<void> {
                    destroyPool();
                    return Promise.resolve();
                },
                validate(): Promise<boolean> {
                    return Promise.resolve(validatePool());
                }
            });
            await generator.stop();
            (generator as any).pagesPool = pagesPool.pool;

            validatePool.mockImplementation(() => false);

            const runner = generator.generatePDF('<html lang="html">Hello World!</html>');
            await new Promise(resolve => setTimeout(resolve, 240));

            expect(validatePool.mock.calls.length).toBeGreaterThan(1);
            validatePool.mockReset();
            expect(validatePool).toBeCalledTimes(0);
            validatePool.mockImplementation(() => true);
            await expect(runner).resolves.toBeDefined();
        }, 60000)

        test('Generator have to release resource in case of exception', async () => {
            const pagesPool = getMockedPool();
            await generator.stop();
            (generator as any).pagesPool = pagesPool.pool;

            pagesPool.setPdfMethod(() => {
                return new Promise((_, reject) => setTimeout(() => reject(new Error("Error from generator")), 50));
            });

            // Handle exception during rendering
            {
                await expect(generator.generatePDF('<html lang="html">Hello World!</html>')).rejects.toEqual(new Error("Error from generator"))

                pagesPool.setPdfMethod();
                await generator.generatePDF('<html lang="html">Hello World!</html>');
                expect(pagesPool.mockedPage.page.pdf).toBeCalled();
            }

            // Handle exception during setting content
            {
                pagesPool.setSetContentMethod(() => {
                    throw new Error("Error from setContent")
                });
                await expect(generator.generatePDF('<html lang="html">Hello World!</html>')).rejects.toEqual(new Error("Error from setContent"))

                pagesPool.setSetContentMethod();
                pagesPool.setPdfMethod();
                await generator.generatePDF('<html lang="html">Hello World!</html>');
                expect(pagesPool.mockedPage.page.pdf).toBeCalled();
            }
        }, 60000);

        test('Stream have to release resource in case of exception', async () => {
            const pagesPool = getMockedPool();
            await generator.stop();
            (generator as any).pagesPool = pagesPool.pool;

            // Handle exception from generator
            {
                pagesPool.setCreatePDFStreamMethod(() => {
                    throw new Error("Error from generator");
                })

                await expect(generator.generatePDF('<html lang="html">Hello World!</html>', true)).rejects.toEqual(new Error("Error from generator"));

                pagesPool.setCreatePDFStreamMethod();
                await readStream(await generator.generatePDF('<html lang="html">Hello World!</html>', true));
                expect(pagesPool.mockedPage.page.createPDFStream).toBeCalled();
            }

            // Handle exception from stream
            {
                pagesPool.setCreatePDFStreamMethod(() => {
                    const stream = new Stream.Readable({
                        read: () => {},
                    });
                    setTimeout(() => {
                        stream.push(Buffer.from("abc", "utf-8"));
                        stream.emit('error', new Error("Error from stream"));
                    }, 50);
                    return stream;
                });

                await expect(readStream(await generator.generatePDF('<html lang="html">Hello World!</html>', true))).rejects.toEqual(new Error("Error from stream"));

                pagesPool.setCreatePDFStreamMethod();
                await readStream(await generator.generatePDF('<html lang="html">Hello World!</html>', true));
                expect(pagesPool.mockedPage.page.createPDFStream).toBeCalled();
            }
        }, 60000);
    });
});