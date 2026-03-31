import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'

/**
 * Vite plugin to inject <base href="/"> for SPA routing
 */
function injectBaseTag(): Plugin {
  return {
    name: 'inject-base-tag',
    transformIndexHtml() {
      return [
        {
          tag: 'base',
          attrs: { href: '/' },
          injectTo: 'head-prepend',
        },
      ]
    },
  }
}

/**
 * Vite plugin to replace dvh units with vh units
 */
function dvhToVh(): Plugin {
  return {
    name: 'dvh-to-vh',
    transform(code, id) {
      if (id.endsWith('.css') || id.endsWith('.scss') || id.endsWith('.sass')) {
        return {
          code: code.replace(/(\d+)dvh/g, '$1vh'),
          map: null,
        }
      }
      return null
    },
  }
}

export default defineConfig(({ mode }) => {
  const isProduction = mode === 'production'

  return {
    root: 'src/renderer',
    plugins: [
      TanStackRouterVite({
        target: 'react',
        autoCodeSplitting: true,
        routesDirectory: './src/renderer/routes',
        generatedRouteTree: './src/renderer/routeTree.gen.ts',
      }),
      react(),
      dvhToVh(),
      injectBaseTag(),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src/renderer'),
        '@shared': path.resolve(__dirname, 'src/shared'),
      },
    },
    build: {
      outDir: path.resolve(__dirname, 'dist'),
      emptyOutDir: true,
      target: 'es2020',
      sourcemap: isProduction ? 'hidden' : true,
      minify: isProduction ? 'esbuild' : false,
      rollupOptions: {
        output: {
          entryFileNames: 'js/[name].[hash].js',
          chunkFileNames: 'js/[name].[hash].js',
          assetFileNames: (assetInfo) => {
            if (assetInfo.name?.endsWith('.css')) {
              return 'styles/[name].[hash][extname]'
            }
            if (/\.(woff|woff2|eot|ttf|otf)$/i.test(assetInfo.name || '')) {
              return 'fonts/[name].[hash][extname]'
            }
            if (/\.(png|jpg|jpeg|gif|svg|webp|ico)$/i.test(assetInfo.name || '')) {
              return 'images/[name].[hash][extname]'
            }
            return 'assets/[name].[hash][extname]'
          },
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('@ai-sdk') || id.includes('ai/')) {
                return 'vendor-ai'
              }
              if (id.includes('@mantine') || id.includes('@tabler')) {
                return 'vendor-ui'
              }
              if (id.includes('mermaid') || id.includes('d3')) {
                return 'vendor-charts'
              }
            }
          },
        },
      },
    },
    css: {
      modules: {
        generateScopedName: '[name]__[local]___[hash:base64:5]',
      },
    },
    server: {
      port: 1212,
      strictPort: true,
    },
    define: {
      'process.type': '"renderer"',
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
      'process.env.CHATBOX_BUILD_TARGET': JSON.stringify('web_app'),
      'process.env.CHATBOX_BUILD_PLATFORM': JSON.stringify('web'),
      'process.env.CHATBOX_BUILD_CHANNEL': JSON.stringify('unknown'),
      'process.env.USE_LOCAL_API': JSON.stringify(process.env.USE_LOCAL_API || ''),
      'process.env.USE_BETA_API': JSON.stringify(''),
    },
    optimizeDeps: {
      include: ['mermaid'],
      esbuildOptions: {
        target: 'es2015',
      },
    },
  }
})
