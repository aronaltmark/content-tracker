import js from '@eslint/js'
import vue from 'eslint-plugin-vue'
import globals from 'globals'

export default [
	{ ignores: ['out/', 'release/', 'test-results/', 'playwright-report/'] },
	js.configs.recommended,
	...vue.configs['flat/recommended'],
	{
		languageOptions: {
			globals: { ...globals.node, ...globals.browser }
		},
		rules: {
			'vue/html-indent': ['error', 'tab'],
			'vue/max-attributes-per-line': 'off',
			'vue/singleline-html-element-content-newline': 'off',
			'vue/multi-word-component-names': 'off'
		}
	}
]
