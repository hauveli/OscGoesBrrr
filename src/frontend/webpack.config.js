const path = require('path');

module.exports = {
    entry: './renderer',
    output: {
        path: path.resolve(__dirname, '../../app'),
        filename: 'preload.js',
        publicPath: '',
    },
    target: 'electron-renderer',
    devtool: 'source-map',
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: [{loader: 'ts-loader', options: {onlyCompileBundledFiles: true}}],
                exclude: /node_modules/,
            },
            {
                test: /\.css$/i,
                use: [
                    { loader: "style-loader", options: { injectType: "lazyStyleTag" } },
                    "css-loader",
                ],
            },
            {
                test: /\.s[ac]ss$/i,
                use: [
                    { loader: "style-loader", options: { injectType: "lazyStyleTag" } },
                    "css-loader",
                    "sass-loader",
                ],
            },
            {
                test: /\.(png)$/,
                type: 'asset/resource',
            },
        ]
    },
    resolve: {
        extensions: ['', '.ts', '.tsx', '.js', '.jsx'],
    },
    mode: 'development',
    watchOptions: {
        poll: 1000,
    },
};
