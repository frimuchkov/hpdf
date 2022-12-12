# hpdf

![](https://github.com/frimuchkov/hpdf/actions/workflows/ci.yml/badge.svg)
[![standard-readme compliant](https://img.shields.io/badge/standard--readme-OK-green.svg?style=flat-square)](https://github.com/RichardLitt/standard-readme)


## About

NodeJS library for generating PDF from HTML with pool of browsers (puppeteer) in the background.

## Why?
There are enough NodeJS libraries to generate PDF from HTML.
Why do you need another one?
- There is no up-to-date libraries.
- There is no libraries with pool (but we have to use pooling when we are talking about browser in the background)

## Features:
- Configurable pool of pages (as resources) in the background
- Fully tested
- Written in TypeScript

## How it works
![](diagram.png)

## Table of Contents

- [Install](#install)
- [Usage](#usage)
- [Maintainers](#maintainers)
- [Contributing](#contributing)
- [License](#license)

## Install

```
npm install hpdf
```

## Usage

```typescript
import fs from 'fs';
import { PdfGenerator } from './src';

const start = async () => {
    const generator = new PdfGenerator({
        min: 3,
        max: 10,
    });

    const helloWorld = await generator.generatePDF('<html lang="html">Hello World!</html>');
    const github = await generator.generatePDF(new URL('https://github.com/frimuchkov/hpdf'));

    await fs.promises.writeFile('./helloWorld.pdf', helloWorld);
    await fs.promises.writeFile('./github.pdf', github);

    await generator.stop();
}
```

## Maintainers

[@frimuchkov](https://github.com/frimuchkov)

## Contributing

~~PRs accepted~~. Everything accepted. Feel free to improve everything you wish.

Small note: If editing the README, please conform to the [standard-readme](https://github.com/RichardLitt/standard-readme) specification.

## License

MIT © 2022 Andrey Frimuchkov
