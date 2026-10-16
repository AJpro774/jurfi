import nesting from 'postcss-nesting';
import customMedia from 'postcss-custom-media';
export default { plugins: [customMedia(), nesting()] };
