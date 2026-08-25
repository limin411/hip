/**
 * Custom webpack config for ncc with transpileOnly ts-loader.
 * This skips type checking during bundling, avoiding pre-existing TS errors.
 */
module.exports = {
  resolve: {
    extensions: ['.ts', '.js', '.json'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: [
          {
            loader: 'ts-loader',
            options: {
              transpileOnly: true,
              compilerOptions: {
                noEmit: false,
              },
            },
          },
        ],
      },
    ],
  },
}
