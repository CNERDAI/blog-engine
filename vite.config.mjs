import {defineConfig} from 'vite';
import {resolve} from 'node:path';
export default defineConfig({publicDir:false,define:{"process.env.NODE_ENV":JSON.stringify("production")},resolve:{alias:{'@':resolve('frontend')}},build:{outDir:'public/assets/editor',emptyOutDir:true,lib:{entry:resolve('frontend/entry.tsx'),formats:['es'],fileName:()=> 'blog-editor.js',cssFileName:'blog-editor'},rollupOptions:{output:{codeSplitting:false}},sourcemap:false}});
