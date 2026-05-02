// React Native + Expo path-alias support
// Wires the `@/*` alias (used in tsconfig.json) into Metro/Babel so imports
// like `import { Button } from '@/components/Button'` resolve.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          root: ['./src'],
          alias: {
            '@': './src',
          },
          extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
        },
      ],
    ],
  };
};
