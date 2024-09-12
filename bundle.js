
(function(l, r) { if (!l || l.getElementById('livereloadscript')) return; r = l.createElement('script'); r.async = 1; r.src = '//' + (self.location.host || 'localhost').split(':')[0] + ':35729/livereload.js?snipver=1'; r.id = 'livereloadscript'; l.getElementsByTagName('head')[0].appendChild(r) })(self.document);
var app = (function () {
    'use strict';

    function noop() { }
    function add_location(element, file, line, column, char) {
        element.__svelte_meta = {
            loc: { file, line, column, char }
        };
    }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }
    let src_url_equal_anchor;
    function src_url_equal(element_src, url) {
        if (!src_url_equal_anchor) {
            src_url_equal_anchor = document.createElement('a');
        }
        src_url_equal_anchor.href = url;
        return element_src === src_url_equal_anchor.href;
    }
    function is_empty(obj) {
        return Object.keys(obj).length === 0;
    }

    const globals = (typeof window !== 'undefined'
        ? window
        : typeof globalThis !== 'undefined'
            ? globalThis
            : global);
    function append(target, node) {
        target.appendChild(node);
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        if (node.parentNode) {
            node.parentNode.removeChild(node);
        }
    }
    function destroy_each(iterations, detaching) {
        for (let i = 0; i < iterations.length; i += 1) {
            if (iterations[i])
                iterations[i].d(detaching);
        }
    }
    function element(name) {
        return document.createElement(name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function empty() {
        return text('');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function prevent_default(fn) {
        return function (event) {
            event.preventDefault();
            // @ts-ignore
            return fn.call(this, event);
        };
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function set_input_value(input, value) {
        input.value = value == null ? '' : value;
    }
    function set_style(node, key, value, important) {
        if (value == null) {
            node.style.removeProperty(key);
        }
        else {
            node.style.setProperty(key, value, important ? 'important' : '');
        }
    }
    function custom_event(type, detail, { bubbles = false, cancelable = false } = {}) {
        const e = document.createEvent('CustomEvent');
        e.initCustomEvent(type, bubbles, cancelable, detail);
        return e;
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }
    function get_current_component() {
        if (!current_component)
            throw new Error('Function called outside component initialization');
        return current_component;
    }
    /**
     * Creates an event dispatcher that can be used to dispatch [component events](/docs#template-syntax-component-directives-on-eventname).
     * Event dispatchers are functions that can take two arguments: `name` and `detail`.
     *
     * Component events created with `createEventDispatcher` create a
     * [CustomEvent](https://developer.mozilla.org/en-US/docs/Web/API/CustomEvent).
     * These events do not [bubble](https://developer.mozilla.org/en-US/docs/Learn/JavaScript/Building_blocks/Events#Event_bubbling_and_capture).
     * The `detail` argument corresponds to the [CustomEvent.detail](https://developer.mozilla.org/en-US/docs/Web/API/CustomEvent/detail)
     * property and can contain any type of data.
     *
     * https://svelte.dev/docs#run-time-svelte-createeventdispatcher
     */
    function createEventDispatcher() {
        const component = get_current_component();
        return (type, detail, { cancelable = false } = {}) => {
            const callbacks = component.$$.callbacks[type];
            if (callbacks) {
                // TODO are there situations where events could be dispatched
                // in a server (non-DOM) environment?
                const event = custom_event(type, detail, { cancelable });
                callbacks.slice().forEach(fn => {
                    fn.call(component, event);
                });
                return !event.defaultPrevented;
            }
            return true;
        };
    }

    const dirty_components = [];
    const binding_callbacks = [];
    let render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = /* @__PURE__ */ Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    // flush() calls callbacks in this order:
    // 1. All beforeUpdate callbacks, in order: parents before children
    // 2. All bind:this callbacks, in reverse order: children before parents.
    // 3. All afterUpdate callbacks, in order: parents before children. EXCEPT
    //    for afterUpdates called during the initial onMount, which are called in
    //    reverse order: children before parents.
    // Since callbacks might update component values, which could trigger another
    // call to flush(), the following steps guard against this:
    // 1. During beforeUpdate, any updated components will be added to the
    //    dirty_components array and will cause a reentrant call to flush(). Because
    //    the flush index is kept outside the function, the reentrant call will pick
    //    up where the earlier call left off and go through all dirty components. The
    //    current_component value is saved and restored so that the reentrant call will
    //    not interfere with the "parent" flush() call.
    // 2. bind:this callbacks cannot trigger new flush() calls.
    // 3. During afterUpdate, any updated components will NOT have their afterUpdate
    //    callback called a second time; the seen_callbacks set, outside the flush()
    //    function, guarantees this behavior.
    const seen_callbacks = new Set();
    let flushidx = 0; // Do *not* move this inside the flush() function
    function flush() {
        // Do not reenter flush while dirty components are updated, as this can
        // result in an infinite loop. Instead, let the inner flush handle it.
        // Reentrancy is ok afterwards for bindings etc.
        if (flushidx !== 0) {
            return;
        }
        const saved_component = current_component;
        do {
            // first, call beforeUpdate functions
            // and update components
            try {
                while (flushidx < dirty_components.length) {
                    const component = dirty_components[flushidx];
                    flushidx++;
                    set_current_component(component);
                    update(component.$$);
                }
            }
            catch (e) {
                // reset dirty state to not end up in a deadlocked state and then rethrow
                dirty_components.length = 0;
                flushidx = 0;
                throw e;
            }
            set_current_component(null);
            dirty_components.length = 0;
            flushidx = 0;
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                    callback();
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
        seen_callbacks.clear();
        set_current_component(saved_component);
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    /**
     * Useful for example to execute remaining `afterUpdate` callbacks before executing `destroy`.
     */
    function flush_render_callbacks(fns) {
        const filtered = [];
        const targets = [];
        render_callbacks.forEach((c) => fns.indexOf(c) === -1 ? filtered.push(c) : targets.push(c));
        targets.forEach((c) => c());
        render_callbacks = filtered;
    }
    const outroing = new Set();
    let outros;
    function group_outros() {
        outros = {
            r: 0,
            c: [],
            p: outros // parent group
        };
    }
    function check_outros() {
        if (!outros.r) {
            run_all(outros.c);
        }
        outros = outros.p;
    }
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function transition_out(block, local, detach, callback) {
        if (block && block.o) {
            if (outroing.has(block))
                return;
            outroing.add(block);
            outros.c.push(() => {
                outroing.delete(block);
                if (callback) {
                    if (detach)
                        block.d(1);
                    callback();
                }
            });
            block.o(local);
        }
        else if (callback) {
            callback();
        }
    }
    function create_component(block) {
        block && block.c();
    }
    function mount_component(component, target, anchor, customElement) {
        const { fragment, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        if (!customElement) {
            // onMount happens before the initial afterUpdate
            add_render_callback(() => {
                const new_on_destroy = component.$$.on_mount.map(run).filter(is_function);
                // if the component was destroyed immediately
                // it will update the `$$.on_destroy` reference to `null`.
                // the destructured on_destroy may still reference to the old array
                if (component.$$.on_destroy) {
                    component.$$.on_destroy.push(...new_on_destroy);
                }
                else {
                    // Edge case - component was destroyed immediately,
                    // most likely as a result of a binding initialising
                    run_all(new_on_destroy);
                }
                component.$$.on_mount = [];
            });
        }
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            flush_render_callbacks($$.after_update);
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, append_styles, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const $$ = component.$$ = {
            fragment: null,
            ctx: [],
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            on_disconnect: [],
            before_update: [],
            after_update: [],
            context: new Map(options.context || (parent_component ? parent_component.$$.context : [])),
            // everything else
            callbacks: blank_object(),
            dirty,
            skip_bound: false,
            root: options.target || parent_component.$$.root
        };
        append_styles && append_styles($$.root);
        let ready = false;
        $$.ctx = instance
            ? instance(component, options.props || {}, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if (!$$.skip_bound && $$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                const nodes = children(options.target);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(nodes);
                nodes.forEach(detach);
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor, options.customElement);
            flush();
        }
        set_current_component(parent_component);
    }
    /**
     * Base class for Svelte components. Used when dev=false.
     */
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            if (!is_function(callback)) {
                return noop;
            }
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set($$props) {
            if (this.$$set && !is_empty($$props)) {
                this.$$.skip_bound = true;
                this.$$set($$props);
                this.$$.skip_bound = false;
            }
        }
    }

    function dispatch_dev(type, detail) {
        document.dispatchEvent(custom_event(type, Object.assign({ version: '3.59.2' }, detail), { bubbles: true }));
    }
    function append_dev(target, node) {
        dispatch_dev('SvelteDOMInsert', { target, node });
        append(target, node);
    }
    function insert_dev(target, node, anchor) {
        dispatch_dev('SvelteDOMInsert', { target, node, anchor });
        insert(target, node, anchor);
    }
    function detach_dev(node) {
        dispatch_dev('SvelteDOMRemove', { node });
        detach(node);
    }
    function listen_dev(node, event, handler, options, has_prevent_default, has_stop_propagation, has_stop_immediate_propagation) {
        const modifiers = options === true ? ['capture'] : options ? Array.from(Object.keys(options)) : [];
        if (has_prevent_default)
            modifiers.push('preventDefault');
        if (has_stop_propagation)
            modifiers.push('stopPropagation');
        if (has_stop_immediate_propagation)
            modifiers.push('stopImmediatePropagation');
        dispatch_dev('SvelteDOMAddEventListener', { node, event, handler, modifiers });
        const dispose = listen(node, event, handler, options);
        return () => {
            dispatch_dev('SvelteDOMRemoveEventListener', { node, event, handler, modifiers });
            dispose();
        };
    }
    function attr_dev(node, attribute, value) {
        attr(node, attribute, value);
        if (value == null)
            dispatch_dev('SvelteDOMRemoveAttribute', { node, attribute });
        else
            dispatch_dev('SvelteDOMSetAttribute', { node, attribute, value });
    }
    function prop_dev(node, property, value) {
        node[property] = value;
        dispatch_dev('SvelteDOMSetProperty', { node, property, value });
    }
    function set_data_dev(text, data) {
        data = '' + data;
        if (text.data === data)
            return;
        dispatch_dev('SvelteDOMSetData', { node: text, data });
        text.data = data;
    }
    function validate_each_argument(arg) {
        if (typeof arg !== 'string' && !(arg && typeof arg === 'object' && 'length' in arg)) {
            let msg = '{#each} only iterates over array-like objects.';
            if (typeof Symbol === 'function' && arg && Symbol.iterator in arg) {
                msg += ' You can use a spread to convert this iterable into an array.';
            }
            throw new Error(msg);
        }
    }
    function validate_slots(name, slot, keys) {
        for (const slot_key of Object.keys(slot)) {
            if (!~keys.indexOf(slot_key)) {
                console.warn(`<${name}> received an unexpected slot "${slot_key}".`);
            }
        }
    }
    /**
     * Base class for Svelte components with some minor dev-enhancements. Used when dev=true.
     */
    class SvelteComponentDev extends SvelteComponent {
        constructor(options) {
            if (!options || (!options.target && !options.$$inline)) {
                throw new Error("'target' is a required option");
            }
            super();
        }
        $destroy() {
            super.$destroy();
            this.$destroy = () => {
                console.warn('Component was already destroyed'); // eslint-disable-line no-console
            };
        }
        $capture_state() { }
        $inject_state() { }
    }

    /* src\SearchBar.svelte generated by Svelte v3.59.2 */

    const { Error: Error_1 } = globals;
    const file$5 = "src\\SearchBar.svelte";

    // (61:4) {#if isOpen}
    function create_if_block_1(ctx) {
    	let form;
    	let input0;
    	let t0;
    	let input1;
    	let t1;
    	let input2;
    	let input2_disabled_value;
    	let input2_value_value;
    	let mounted;
    	let dispose;

    	const block = {
    		c: function create() {
    			form = element("form");
    			input0 = element("input");
    			t0 = space();
    			input1 = element("input");
    			t1 = space();
    			input2 = element("input");
    			attr_dev(input0, "id", "csa-repairs-search-number");
    			attr_dev(input0, "name", "csa-repairs-search-number");
    			attr_dev(input0, "class", "csa-text-field csa-w-input csa-repairs-search-number");
    			attr_dev(input0, "maxlength", "256");
    			attr_dev(input0, "placeholder", "Order Number");
    			attr_dev(input0, "type", "text");
    			attr_dev(input0, "autocomplete", "off");
    			add_location(input0, file$5, 67, 8, 1984);
    			attr_dev(input1, "id", "csa-repairs-search-lname");
    			attr_dev(input1, "name", "csa-repairs-search-lname");
    			attr_dev(input1, "class", "csa-text-field csa-w-input csa-repairs-search-lname");
    			attr_dev(input1, "maxlength", "256");
    			attr_dev(input1, "placeholder", "Last Name");
    			attr_dev(input1, "type", "text");
    			attr_dev(input1, "autocomplete", "off");
    			add_location(input1, file$5, 78, 12, 2385);
    			input2.disabled = input2_disabled_value = /*isFieldEmpty*/ ctx[5] || /*isSearching*/ ctx[3];
    			attr_dev(input2, "type", "submit");
    			attr_dev(input2, "id", "csa-submit-button");
    			attr_dev(input2, "class", "csa-submit-button");
    			input2.value = input2_value_value = /*isSearching*/ ctx[3] ? "Searching..." : "Search";
    			add_location(input2, file$5, 88, 8, 2740);
    			attr_dev(form, "id", "csa-email-form");
    			attr_dev(form, "name", "csa-email-form");
    			attr_dev(form, "class", "csa-section-search-form");
    			attr_dev(form, "aria-label", "Search Form");
    			add_location(form, file$5, 61, 4, 1786);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, form, anchor);
    			append_dev(form, input0);
    			set_input_value(input0, /*jobNumber*/ ctx[0]);
    			append_dev(form, t0);
    			append_dev(form, input1);
    			set_input_value(input1, /*lastName*/ ctx[1]);
    			append_dev(form, t1);
    			append_dev(form, input2);

    			if (!mounted) {
    				dispose = [
    					listen_dev(input0, "input", /*input0_input_handler*/ ctx[9]),
    					listen_dev(input0, "keypress", /*onInput*/ ctx[7], false, false, false, false),
    					listen_dev(input1, "input", /*input1_input_handler*/ ctx[10]),
    					listen_dev(form, "submit", prevent_default(/*search*/ ctx[6]), false, true, false, false)
    				];

    				mounted = true;
    			}
    		},
    		p: function update(ctx, dirty) {
    			if (dirty & /*jobNumber*/ 1 && input0.value !== /*jobNumber*/ ctx[0]) {
    				set_input_value(input0, /*jobNumber*/ ctx[0]);
    			}

    			if (dirty & /*lastName*/ 2 && input1.value !== /*lastName*/ ctx[1]) {
    				set_input_value(input1, /*lastName*/ ctx[1]);
    			}

    			if (dirty & /*isFieldEmpty, isSearching*/ 40 && input2_disabled_value !== (input2_disabled_value = /*isFieldEmpty*/ ctx[5] || /*isSearching*/ ctx[3])) {
    				prop_dev(input2, "disabled", input2_disabled_value);
    			}

    			if (dirty & /*isSearching*/ 8 && input2_value_value !== (input2_value_value = /*isSearching*/ ctx[3] ? "Searching..." : "Search")) {
    				prop_dev(input2, "value", input2_value_value);
    			}
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(form);
    			mounted = false;
    			run_all(dispose);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block_1.name,
    		type: "if",
    		source: "(61:4) {#if isOpen}",
    		ctx
    	});

    	return block;
    }

    // (99:0) {#if data && data.count == 0}
    function create_if_block$3(ctx) {
    	let div;

    	const block = {
    		c: function create() {
    			div = element("div");
    			div.textContent = "Job not found.";
    			attr_dev(div, "class", "csa-not-found-msg");
    			add_location(div, file$5, 99, 0, 3034);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div, anchor);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block$3.name,
    		type: "if",
    		source: "(99:0) {#if data && data.count == 0}",
    		ctx
    	});

    	return block;
    }

    function create_fragment$5(ctx) {
    	let div1;
    	let div0;
    	let t0;
    	let span;
    	let t1_value = (/*isOpen*/ ctx[4] ? '▲' : '▼') + "";
    	let t1;
    	let t2;
    	let t3;
    	let if_block1_anchor;
    	let mounted;
    	let dispose;
    	let if_block0 = /*isOpen*/ ctx[4] && create_if_block_1(ctx);
    	let if_block1 = /*data*/ ctx[2] && /*data*/ ctx[2].count == 0 && create_if_block$3(ctx);

    	const block = {
    		c: function create() {
    			div1 = element("div");
    			div0 = element("div");
    			t0 = text("Order Lookup\r\n        ");
    			span = element("span");
    			t1 = text(t1_value);
    			t2 = space();
    			if (if_block0) if_block0.c();
    			t3 = space();
    			if (if_block1) if_block1.c();
    			if_block1_anchor = empty();
    			attr_dev(span, "class", "csa-search-arrow");
    			add_location(span, file$5, 58, 8, 1692);
    			attr_dev(div0, "class", "csa-text-title csa-text-title-section");
    			add_location(div0, file$5, 56, 4, 1575);
    			attr_dev(div1, "class", "csa-section-search");
    			add_location(div1, file$5, 55, 0, 1537);
    		},
    		l: function claim(nodes) {
    			throw new Error_1("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div1, anchor);
    			append_dev(div1, div0);
    			append_dev(div0, t0);
    			append_dev(div0, span);
    			append_dev(span, t1);
    			append_dev(div1, t2);
    			if (if_block0) if_block0.m(div1, null);
    			insert_dev(target, t3, anchor);
    			if (if_block1) if_block1.m(target, anchor);
    			insert_dev(target, if_block1_anchor, anchor);

    			if (!mounted) {
    				dispose = listen_dev(div0, "click", /*click_handler*/ ctx[8], false, false, false, false);
    				mounted = true;
    			}
    		},
    		p: function update(ctx, [dirty]) {
    			if (dirty & /*isOpen*/ 16 && t1_value !== (t1_value = (/*isOpen*/ ctx[4] ? '▲' : '▼') + "")) set_data_dev(t1, t1_value);

    			if (/*isOpen*/ ctx[4]) {
    				if (if_block0) {
    					if_block0.p(ctx, dirty);
    				} else {
    					if_block0 = create_if_block_1(ctx);
    					if_block0.c();
    					if_block0.m(div1, null);
    				}
    			} else if (if_block0) {
    				if_block0.d(1);
    				if_block0 = null;
    			}

    			if (/*data*/ ctx[2] && /*data*/ ctx[2].count == 0) {
    				if (if_block1) ; else {
    					if_block1 = create_if_block$3(ctx);
    					if_block1.c();
    					if_block1.m(if_block1_anchor.parentNode, if_block1_anchor);
    				}
    			} else if (if_block1) {
    				if_block1.d(1);
    				if_block1 = null;
    			}
    		},
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div1);
    			if (if_block0) if_block0.d();
    			if (detaching) detach_dev(t3);
    			if (if_block1) if_block1.d(detaching);
    			if (detaching) detach_dev(if_block1_anchor);
    			mounted = false;
    			dispose();
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$5.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance$5($$self, $$props, $$invalidate) {
    	let isFieldEmpty;
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('SearchBar', slots, []);
    	const dispatch = createEventDispatcher();
    	let jobNumber = '';
    	let lastName = '';
    	let data;
    	let isSearching = false;
    	let isOpen = true;

    	async function search() {
    		try {
    			$$invalidate(2, data = null);
    			$$invalidate(3, isSearching = true);

    			const response = await fetch(`https://airtable-proxy-roan.vercel.app/?jobId=${jobNumber}&lastName=${lastName}`, {
    				headers: { 'Content-Type': 'application/json' },
    				crossDomain: true
    			});

    			if (!response.ok) {
    				throw new Error('Error fetching job data.');
    			}

    			$$invalidate(2, data = await response.json());
    		} catch(err) {
    			$$invalidate(2, data = { count: 0, msg: err });
    		} finally {
    			$$invalidate(3, isSearching = false);
    			dispatch('onSearch', data);
    			$$invalidate(4, isOpen = data.count == 0);

    			if (data.count > 0) {
    				$$invalidate(0, jobNumber = '');
    				$$invalidate(1, lastName = '');
    			}
    		}
    	}

    	function onInput(event) {
    		const charCode = event.which ? event.which : event.keyCode;

    		// Allow only numbers (0-9)
    		if (charCode < 48 || charCode > 57) {
    			event.preventDefault();
    		} else {
    			$$invalidate(0, jobNumber = event.target.value);
    		}
    	}

    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<SearchBar> was created with unknown prop '${key}'`);
    	});

    	const click_handler = () => $$invalidate(4, isOpen = !isOpen);

    	function input0_input_handler() {
    		jobNumber = this.value;
    		$$invalidate(0, jobNumber);
    	}

    	function input1_input_handler() {
    		lastName = this.value;
    		$$invalidate(1, lastName);
    	}

    	$$self.$capture_state = () => ({
    		createEventDispatcher,
    		dispatch,
    		jobNumber,
    		lastName,
    		data,
    		isSearching,
    		isOpen,
    		search,
    		onInput,
    		isFieldEmpty
    	});

    	$$self.$inject_state = $$props => {
    		if ('jobNumber' in $$props) $$invalidate(0, jobNumber = $$props.jobNumber);
    		if ('lastName' in $$props) $$invalidate(1, lastName = $$props.lastName);
    		if ('data' in $$props) $$invalidate(2, data = $$props.data);
    		if ('isSearching' in $$props) $$invalidate(3, isSearching = $$props.isSearching);
    		if ('isOpen' in $$props) $$invalidate(4, isOpen = $$props.isOpen);
    		if ('isFieldEmpty' in $$props) $$invalidate(5, isFieldEmpty = $$props.isFieldEmpty);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*jobNumber, lastName*/ 3) {
    			$$invalidate(5, isFieldEmpty = jobNumber.trim().length < 1 || lastName.trim().length < 1);
    		}
    	};

    	return [
    		jobNumber,
    		lastName,
    		data,
    		isSearching,
    		isOpen,
    		isFieldEmpty,
    		search,
    		onInput,
    		click_handler,
    		input0_input_handler,
    		input1_input_handler
    	];
    }

    class SearchBar extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$5, create_fragment$5, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "SearchBar",
    			options,
    			id: create_fragment$5.name
    		});
    	}
    }

    function pipe(value, ...fns) {
        return fns.reduce((acc, fn) => fn(acc), value);
    }

    function capitalize(str) {
        str = str.toLowerCase();
        const result = str.charAt(0).toUpperCase() + str.slice(1);
        return result;
    }

    function trim(str) {
        return str.trim();
    }

    const specialStatuses = ['action required', 'declined', 'not repairable'];

    function formatRepairName(name) {
        if (name.endsWith('s') || name.endsWith('S')) {
            return `${name}' `;
        }

        return `${name}'s `;
    }

    function formatDate(dateAsString) {
        console.log(dateAsString);
        if (!dateAsString) {
            return 'Pending Estimation';
        }

        // Extract month from the date string
        const monthIndex = parseInt(dateAsString.slice(5, 7)) - 1; // Extract month (0-based)

        const months = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "Jun.", "Jul.", "Aug.", "Sep.", "Oct.", "Nov.", "Dec."];
        const month = months[monthIndex];
        const day = parseInt(dateAsString.slice(8)); // Extract day

        // Get the ordinal suffix for the day
        function getOrdinalSuffix(day) {
            if (day > 3 && day < 21) return 'th'; // Because 11th, 12th, 13th
            switch (day % 10) {
            case 1: return "st";
            case 2: return "nd";
            case 3: return "rd";
            default: return "th";
            }
        }

        return `${month} ${day}${getOrdinalSuffix(day)}`;
    }

    function mapStatus(status) {
        const statusMap = {
            'New': ['new', 'arriving to facility'],
            'Received': ['received', 'quote approved', 'estimate waiting', 'need client approval', 'estimate approved'],
            'In Work': ['in-work', 'overdue in-work', 'overdue in work', 'in work'],
            'In Q.C.': ['in qc', 'ready to ship', 'in q.c.'],
            'Returned': ['returned', 'complete', 'shipped', 'delivered'],
            'Not Repairable': ['not repairable'],
            'Declined': ['declined'],
            'Action Required': ['action required']
        };

        const lowerCaseStatus = status.toLowerCase();

        for (const [category, statuses] of Object.entries(statusMap)) {
            if (statuses.includes(lowerCaseStatus)) {
                return category;
            }
        }

        return null; // Return null if the status is not found
    }

    function getStatus(currentStatus) {
        const status = mapStatus(currentStatus);
        let statusMessage = '';
        if (specialStatuses.includes(status.toLowerCase())) {
            statusMessage = 'One of our service reps will contact you shortly.'; 
        } else {
            statusMessage = status;
        }

        return statusMessage;
    }

    function getClientName(clientName) {
        let name = 'This';
                            
        if (clientName) {
            name = formatRepairName(clientName);
        }

        return pipe(name, trim, capitalize);
    }

    function displayTimeline(status) {
        return !specialStatuses.includes(status.toLowerCase());
    }

    /* src\Footer.svelte generated by Svelte v3.59.2 */

    const file$4 = "src\\Footer.svelte";

    function create_fragment$4(ctx) {
    	let div1;
    	let a0;
    	let t1;
    	let div0;
    	let t2;
    	let a1;
    	let t4;
    	let div2;
    	let t5;
    	let div3;
    	let img;
    	let img_src_value;

    	const block = {
    		c: function create() {
    			div1 = element("div");
    			a0 = element("a");
    			a0.textContent = "Give us a call";
    			t1 = space();
    			div0 = element("div");
    			t2 = space();
    			a1 = element("a");
    			a1.textContent = "Send us a note";
    			t4 = space();
    			div2 = element("div");
    			t5 = space();
    			div3 = element("div");
    			img = element("img");
    			attr_dev(a0, "href", "tel:+16143636103");
    			attr_dev(a0, "class", "csa-footer-btn");
    			add_location(a0, file$4, 1, 4, 61);
    			attr_dev(div0, "class", "csa-footer-gap");
    			add_location(div0, file$4, 2, 4, 135);
    			attr_dev(a1, "href", "mailto:service@kinnstudio.com");
    			attr_dev(a1, "class", "csa-footer-btn");
    			add_location(a1, file$4, 3, 4, 175);
    			attr_dev(div1, "class", "csa-layout-hflex csa-card csa-card-footer");
    			add_location(div1, file$4, 0, 0, 0);
    			attr_dev(div2, "class", "csa-vgap-small");
    			add_location(div2, file$4, 6, 0, 268);
    			if (!src_url_equal(img.src, img_src_value = "https://cdn.jsdelivr.net/gh/cesar-logica/carousel-search-app-pub@main/imgs/poweredby.png")) attr_dev(img, "src", img_src_value);
    			attr_dev(img, "alt", "powered by carousel");
    			attr_dev(img, "class", "csa-poweredy-img");
    			add_location(img, file$4, 9, 4, 340);
    			attr_dev(div3, "class", "csa-powered-by");
    			add_location(div3, file$4, 8, 0, 306);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div1, anchor);
    			append_dev(div1, a0);
    			append_dev(div1, t1);
    			append_dev(div1, div0);
    			append_dev(div1, t2);
    			append_dev(div1, a1);
    			insert_dev(target, t4, anchor);
    			insert_dev(target, div2, anchor);
    			insert_dev(target, t5, anchor);
    			insert_dev(target, div3, anchor);
    			append_dev(div3, img);
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div1);
    			if (detaching) detach_dev(t4);
    			if (detaching) detach_dev(div2);
    			if (detaching) detach_dev(t5);
    			if (detaching) detach_dev(div3);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$4.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance$4($$self, $$props) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('Footer', slots, []);
    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<Footer> was created with unknown prop '${key}'`);
    	});

    	return [];
    }

    class Footer extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$4, create_fragment$4, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Footer",
    			options,
    			id: create_fragment$4.name
    		});
    	}
    }

    /* src\Timeline.svelte generated by Svelte v3.59.2 */

    const file$3 = "src\\Timeline.svelte";

    function get_each_context(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[3] = list[i];
    	child_ctx[5] = i;
    	return child_ctx;
    }

    // (18:4) {#each displayStatuses as status, i}
    function create_each_block(ctx) {
    	let div4;
    	let div2;
    	let div0;
    	let t0;
    	let div1;
    	let t1;
    	let div3;
    	let t2;
    	let t3_value = /*status*/ ctx[3] + "";
    	let t3;
    	let t4;

    	const block = {
    		c: function create() {
    			div4 = element("div");
    			div2 = element("div");
    			div0 = element("div");
    			t0 = space();
    			div1 = element("div");
    			t1 = space();
    			div3 = element("div");
    			t2 = text(" ");
    			t3 = text(t3_value);
    			t4 = space();
    			attr_dev(div0, "class", "csa-tl-block-line");
    			set_style(div0, "background-color", /*getColor*/ ctx[2](/*i*/ ctx[5], /*currentStatus*/ ctx[0]));
    			add_location(div0, file$3, 20, 12, 623);
    			attr_dev(div1, "class", "csa-w-layout-blockcontainer csa-tl-block-indicator csa-w-container");
    			set_style(div1, "background-color", /*getColor*/ ctx[2](/*i*/ ctx[5], /*currentStatus*/ ctx[0]));
    			add_location(div1, file$3, 21, 12, 725);
    			attr_dev(div2, "class", "csa-section-timeline-block-indicator");
    			add_location(div2, file$3, 19, 8, 559);
    			attr_dev(div3, "class", "csa-text-bold csa-text-tl-status");
    			add_location(div3, file$3, 23, 8, 888);
    			attr_dev(div4, "class", "csa-layout-vflex csa-section-timeline-block");
    			add_location(div4, file$3, 18, 4, 492);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div4, anchor);
    			append_dev(div4, div2);
    			append_dev(div2, div0);
    			append_dev(div2, t0);
    			append_dev(div2, div1);
    			append_dev(div4, t1);
    			append_dev(div4, div3);
    			append_dev(div3, t2);
    			append_dev(div3, t3);
    			append_dev(div4, t4);
    		},
    		p: function update(ctx, dirty) {
    			if (dirty & /*currentStatus*/ 1) {
    				set_style(div0, "background-color", /*getColor*/ ctx[2](/*i*/ ctx[5], /*currentStatus*/ ctx[0]));
    			}

    			if (dirty & /*currentStatus*/ 1) {
    				set_style(div1, "background-color", /*getColor*/ ctx[2](/*i*/ ctx[5], /*currentStatus*/ ctx[0]));
    			}
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div4);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_each_block.name,
    		type: "each",
    		source: "(18:4) {#each displayStatuses as status, i}",
    		ctx
    	});

    	return block;
    }

    function create_fragment$3(ctx) {
    	let div;
    	let each_value = /*displayStatuses*/ ctx[1];
    	validate_each_argument(each_value);
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
    	}

    	const block = {
    		c: function create() {
    			div = element("div");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			attr_dev(div, "class", "csa-section-timeline csa-section-timeline--mobile");
    			add_location(div, file$3, 16, 0, 381);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div, anchor);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				if (each_blocks[i]) {
    					each_blocks[i].m(div, null);
    				}
    			}
    		},
    		p: function update(ctx, [dirty]) {
    			if (dirty & /*displayStatuses, getColor, currentStatus*/ 7) {
    				each_value = /*displayStatuses*/ ctx[1];
    				validate_each_argument(each_value);
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(div, null);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value.length;
    			}
    		},
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div);
    			destroy_each(each_blocks, detaching);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$3.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance$3($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('Timeline', slots, []);
    	let { currentStatus = '' } = $$props;
    	const displayStatuses = ["New", "Received", "In Work", "In Q.C.", "Returned"];

    	function getColor(index) {
    		const currentIndex = displayStatuses.indexOf(currentStatus);

    		if (index <= currentIndex) {
    			return "#999283";
    		}

    		return "#dfdfdf";
    	}

    	const writable_props = ['currentStatus'];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<Timeline> was created with unknown prop '${key}'`);
    	});

    	$$self.$$set = $$props => {
    		if ('currentStatus' in $$props) $$invalidate(0, currentStatus = $$props.currentStatus);
    	};

    	$$self.$capture_state = () => ({ currentStatus, displayStatuses, getColor });

    	$$self.$inject_state = $$props => {
    		if ('currentStatus' in $$props) $$invalidate(0, currentStatus = $$props.currentStatus);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	return [currentStatus, displayStatuses, getColor];
    }

    class Timeline extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$3, create_fragment$3, safe_not_equal, { currentStatus: 0 });

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Timeline",
    			options,
    			id: create_fragment$3.name
    		});
    	}

    	get currentStatus() {
    		throw new Error("<Timeline>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set currentStatus(value) {
    		throw new Error("<Timeline>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}
    }

    /* src\SearchResult.svelte generated by Svelte v3.59.2 */
    const file$2 = "src\\SearchResult.svelte";

    // (56:20) {#if displayTimeline(searchResult.jobStatus)}
    function create_if_block$2(ctx) {
    	let timeline;
    	let current;

    	timeline = new Timeline({
    			props: { currentStatus: /*mappedStatus*/ ctx[1] },
    			$$inline: true
    		});

    	const block = {
    		c: function create() {
    			create_component(timeline.$$.fragment);
    		},
    		m: function mount(target, anchor) {
    			mount_component(timeline, target, anchor);
    			current = true;
    		},
    		p: function update(ctx, dirty) {
    			const timeline_changes = {};
    			if (dirty & /*mappedStatus*/ 2) timeline_changes.currentStatus = /*mappedStatus*/ ctx[1];
    			timeline.$set(timeline_changes);
    		},
    		i: function intro(local) {
    			if (current) return;
    			transition_in(timeline.$$.fragment, local);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(timeline.$$.fragment, local);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			destroy_component(timeline, detaching);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block$2.name,
    		type: "if",
    		source: "(56:20) {#if displayTimeline(searchResult.jobStatus)}",
    		ctx
    	});

    	return block;
    }

    function create_fragment$2(ctx) {
    	let div34;
    	let div0;
    	let span;
    	let t1;
    	let div1;
    	let t2;
    	let div22;
    	let div21;
    	let div20;
    	let div5;
    	let h10;
    	let t3;
    	let t4;
    	let t5;
    	let div2;
    	let t6;
    	let div3;
    	let t8;
    	let div4;
    	let t9;
    	let t10_value = /*searchResult*/ ctx[0].jobNumber + "";
    	let t10;
    	let t11;
    	let div19;
    	let div15;
    	let div8;
    	let div6;
    	let t13;
    	let div7;
    	let t14;
    	let t15;
    	let div11;
    	let div9;
    	let t17;
    	let div10;
    	let t18_value = /*searchResult*/ ctx[0].returnAddress + "";
    	let t18;
    	let t19;
    	let div14;
    	let div12;
    	let t21;
    	let div13;
    	let t22_value = /*searchResult*/ ctx[0].jobNumber + "";
    	let t22;
    	let t23;
    	let div18;
    	let div16;
    	let t25;
    	let div17;
    	let t26;
    	let t27;
    	let show_if = displayTimeline(/*searchResult*/ ctx[0].jobStatus);
    	let t28;
    	let div23;
    	let t29;
    	let div31;
    	let div30;
    	let div26;
    	let h11;
    	let t31;
    	let div24;
    	let t32;
    	let div25;
    	let t33_value = /*searchResult*/ ctx[0].serviceDescription + "";
    	let t33;
    	let t34;
    	let div29;
    	let h12;
    	let t36;
    	let div27;
    	let t37;
    	let div28;
    	let t38;
    	let t39;
    	let div32;
    	let t40;
    	let div33;
    	let footer;
    	let current;
    	let if_block = show_if && create_if_block$2(ctx);
    	footer = new Footer({ $$inline: true });

    	const block = {
    		c: function create() {
    			div34 = element("div");
    			div0 = element("div");
    			span = element("span");
    			span.textContent = "Repair Status Lookup";
    			t1 = space();
    			div1 = element("div");
    			t2 = space();
    			div22 = element("div");
    			div21 = element("div");
    			div20 = element("div");
    			div5 = element("div");
    			h10 = element("h1");
    			t3 = text(/*clientName*/ ctx[5]);
    			t4 = text(" Repair");
    			t5 = space();
    			div2 = element("div");
    			t6 = space();
    			div3 = element("div");
    			div3.textContent = "Current Repair";
    			t8 = space();
    			div4 = element("div");
    			t9 = text("Job: ");
    			t10 = text(t10_value);
    			t11 = space();
    			div19 = element("div");
    			div15 = element("div");
    			div8 = element("div");
    			div6 = element("div");
    			div6.textContent = "Order Placed:";
    			t13 = space();
    			div7 = element("div");
    			t14 = text(/*subDate*/ ctx[3]);
    			t15 = space();
    			div11 = element("div");
    			div9 = element("div");
    			div9.textContent = "Return Address:";
    			t17 = space();
    			div10 = element("div");
    			t18 = text(t18_value);
    			t19 = space();
    			div14 = element("div");
    			div12 = element("div");
    			div12.textContent = "Job Number:";
    			t21 = space();
    			div13 = element("div");
    			t22 = text(t22_value);
    			t23 = space();
    			div18 = element("div");
    			div16 = element("div");
    			div16.textContent = "Order Status: ";
    			t25 = space();
    			div17 = element("div");
    			t26 = text(/*status*/ ctx[2]);
    			t27 = space();
    			if (if_block) if_block.c();
    			t28 = space();
    			div23 = element("div");
    			t29 = space();
    			div31 = element("div");
    			div30 = element("div");
    			div26 = element("div");
    			h11 = element("h1");
    			h11.textContent = "Artisan Notes";
    			t31 = space();
    			div24 = element("div");
    			t32 = space();
    			div25 = element("div");
    			t33 = text(t33_value);
    			t34 = space();
    			div29 = element("div");
    			h12 = element("h1");
    			h12.textContent = "Due Date";
    			t36 = space();
    			div27 = element("div");
    			t37 = space();
    			div28 = element("div");
    			t38 = text(/*completionDate*/ ctx[4]);
    			t39 = space();
    			div32 = element("div");
    			t40 = space();
    			div33 = element("div");
    			create_component(footer.$$.fragment);
    			attr_dev(span, "class", "csa-text-title");
    			add_location(span, file$2, 22, 8, 657);
    			add_location(div0, file$2, 21, 4, 642);
    			attr_dev(div1, "class", "csa-vgap");
    			add_location(div1, file$2, 25, 4, 733);
    			attr_dev(h10, "class", "csa-text-header");
    			add_location(h10, file$2, 31, 20, 979);
    			attr_dev(div2, "class", "csa-status-line");
    			add_location(div2, file$2, 32, 20, 1053);
    			attr_dev(div3, "class", "csa-text-regular csa-text-current-repair");
    			add_location(div3, file$2, 33, 20, 1106);
    			attr_dev(div4, "class", "csa-text-regular");
    			add_location(div4, file$2, 34, 20, 1202);
    			attr_dev(div5, "class", "csa-section-status-left");
    			add_location(div5, file$2, 30, 16, 920);
    			attr_dev(div6, "class", "csa-text-regular");
    			add_location(div6, file$2, 39, 28, 1526);
    			attr_dev(div7, "class", "csa-text-bold csa-text-status-detail");
    			add_location(div7, file$2, 40, 28, 1605);
    			attr_dev(div8, "class", "csa-section-status-header-block");
    			add_location(div8, file$2, 38, 24, 1451);
    			attr_dev(div9, "class", "csa-text-regular");
    			add_location(div9, file$2, 43, 28, 1803);
    			attr_dev(div10, "class", "csa-text-bold csa-text-status-detail");
    			add_location(div10, file$2, 44, 28, 1889);
    			attr_dev(div11, "class", "csa-section-status-header-block");
    			add_location(div11, file$2, 42, 24, 1728);
    			attr_dev(div12, "class", "csa-text-regular");
    			add_location(div12, file$2, 47, 28, 2106);
    			attr_dev(div13, "class", "csa-text-bold csa-text-status-detail");
    			add_location(div13, file$2, 48, 28, 2188);
    			attr_dev(div14, "class", "csa-section-status-header-block");
    			add_location(div14, file$2, 46, 24, 2031);
    			attr_dev(div15, "class", "csa-layout-hflex csa-section-status-header");
    			add_location(div15, file$2, 37, 20, 1369);
    			attr_dev(div16, "class", "csa-text-regular");
    			add_location(div16, file$2, 52, 24, 2413);
    			attr_dev(div17, "class", "csa-text-bold csa-text-status-detail");
    			add_location(div17, file$2, 53, 24, 2499);
    			attr_dev(div18, "class", "csa-section-status-text");
    			add_location(div18, file$2, 51, 20, 2350);
    			attr_dev(div19, "class", "csa-section-status-right");
    			add_location(div19, file$2, 36, 16, 1309);
    			attr_dev(div20, "class", "csa-layout-hflex csa-section-status");
    			add_location(div20, file$2, 29, 12, 853);
    			attr_dev(div21, "class", "csa-section-container");
    			add_location(div21, file$2, 28, 8, 804);
    			attr_dev(div22, "class", "csa-section");
    			add_location(div22, file$2, 27, 4, 769);
    			attr_dev(div23, "class", "csa-vgap");
    			add_location(div23, file$2, 63, 4, 2832);
    			attr_dev(h11, "class", "csa-text-header csa-section-heading-bottom");
    			add_location(h11, file$2, 68, 16, 3091);
    			attr_dev(div24, "class", "csa-status-line csa-status-line-bottom");
    			add_location(div24, file$2, 69, 16, 3182);
    			attr_dev(div25, "class", "csa-text-bold");
    			add_location(div25, file$2, 70, 16, 3253);
    			attr_dev(div26, "class", "csa-layout-vflex csa-section-status csa-section-status-bottom");
    			add_location(div26, file$2, 67, 12, 2998);
    			attr_dev(h12, "class", "csa-text-header csa-section-heading-bottom");
    			add_location(h12, file$2, 73, 16, 3446);
    			attr_dev(div27, "class", "csa-status-line csa-status-line-bottom");
    			add_location(div27, file$2, 74, 16, 3532);
    			attr_dev(div28, "class", "csa-text-completion-date");
    			add_location(div28, file$2, 75, 16, 3603);
    			attr_dev(div29, "class", "csa-layout-vflex csa-section-status csa-section-status-bottom");
    			add_location(div29, file$2, 72, 12, 3353);
    			attr_dev(div30, "class", "csa-layout-hflex csa-section-container csa-section-container-bottom");
    			add_location(div30, file$2, 66, 8, 2903);
    			attr_dev(div31, "class", "csa-section");
    			add_location(div31, file$2, 65, 4, 2868);
    			attr_dev(div32, "class", "csa-vgap");
    			add_location(div32, file$2, 80, 4, 3721);
    			attr_dev(div33, "class", "csa-section");
    			add_location(div33, file$2, 82, 4, 3757);
    			attr_dev(div34, "class", "csa-result-container");
    			add_location(div34, file$2, 20, 0, 602);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div34, anchor);
    			append_dev(div34, div0);
    			append_dev(div0, span);
    			append_dev(div34, t1);
    			append_dev(div34, div1);
    			append_dev(div34, t2);
    			append_dev(div34, div22);
    			append_dev(div22, div21);
    			append_dev(div21, div20);
    			append_dev(div20, div5);
    			append_dev(div5, h10);
    			append_dev(h10, t3);
    			append_dev(h10, t4);
    			append_dev(div5, t5);
    			append_dev(div5, div2);
    			append_dev(div5, t6);
    			append_dev(div5, div3);
    			append_dev(div5, t8);
    			append_dev(div5, div4);
    			append_dev(div4, t9);
    			append_dev(div4, t10);
    			append_dev(div20, t11);
    			append_dev(div20, div19);
    			append_dev(div19, div15);
    			append_dev(div15, div8);
    			append_dev(div8, div6);
    			append_dev(div8, t13);
    			append_dev(div8, div7);
    			append_dev(div7, t14);
    			append_dev(div15, t15);
    			append_dev(div15, div11);
    			append_dev(div11, div9);
    			append_dev(div11, t17);
    			append_dev(div11, div10);
    			append_dev(div10, t18);
    			append_dev(div15, t19);
    			append_dev(div15, div14);
    			append_dev(div14, div12);
    			append_dev(div14, t21);
    			append_dev(div14, div13);
    			append_dev(div13, t22);
    			append_dev(div19, t23);
    			append_dev(div19, div18);
    			append_dev(div18, div16);
    			append_dev(div18, t25);
    			append_dev(div18, div17);
    			append_dev(div17, t26);
    			append_dev(div19, t27);
    			if (if_block) if_block.m(div19, null);
    			append_dev(div34, t28);
    			append_dev(div34, div23);
    			append_dev(div34, t29);
    			append_dev(div34, div31);
    			append_dev(div31, div30);
    			append_dev(div30, div26);
    			append_dev(div26, h11);
    			append_dev(div26, t31);
    			append_dev(div26, div24);
    			append_dev(div26, t32);
    			append_dev(div26, div25);
    			append_dev(div25, t33);
    			append_dev(div30, t34);
    			append_dev(div30, div29);
    			append_dev(div29, h12);
    			append_dev(div29, t36);
    			append_dev(div29, div27);
    			append_dev(div29, t37);
    			append_dev(div29, div28);
    			append_dev(div28, t38);
    			append_dev(div34, t39);
    			append_dev(div34, div32);
    			append_dev(div34, t40);
    			append_dev(div34, div33);
    			mount_component(footer, div33, null);
    			current = true;
    		},
    		p: function update(ctx, [dirty]) {
    			if (!current || dirty & /*clientName*/ 32) set_data_dev(t3, /*clientName*/ ctx[5]);
    			if ((!current || dirty & /*searchResult*/ 1) && t10_value !== (t10_value = /*searchResult*/ ctx[0].jobNumber + "")) set_data_dev(t10, t10_value);
    			if (!current || dirty & /*subDate*/ 8) set_data_dev(t14, /*subDate*/ ctx[3]);
    			if ((!current || dirty & /*searchResult*/ 1) && t18_value !== (t18_value = /*searchResult*/ ctx[0].returnAddress + "")) set_data_dev(t18, t18_value);
    			if ((!current || dirty & /*searchResult*/ 1) && t22_value !== (t22_value = /*searchResult*/ ctx[0].jobNumber + "")) set_data_dev(t22, t22_value);
    			if (!current || dirty & /*status*/ 4) set_data_dev(t26, /*status*/ ctx[2]);
    			if (dirty & /*searchResult*/ 1) show_if = displayTimeline(/*searchResult*/ ctx[0].jobStatus);

    			if (show_if) {
    				if (if_block) {
    					if_block.p(ctx, dirty);

    					if (dirty & /*searchResult*/ 1) {
    						transition_in(if_block, 1);
    					}
    				} else {
    					if_block = create_if_block$2(ctx);
    					if_block.c();
    					transition_in(if_block, 1);
    					if_block.m(div19, null);
    				}
    			} else if (if_block) {
    				group_outros();

    				transition_out(if_block, 1, 1, () => {
    					if_block = null;
    				});

    				check_outros();
    			}

    			if ((!current || dirty & /*searchResult*/ 1) && t33_value !== (t33_value = /*searchResult*/ ctx[0].serviceDescription + "")) set_data_dev(t33, t33_value);
    			if (!current || dirty & /*completionDate*/ 16) set_data_dev(t38, /*completionDate*/ ctx[4]);
    		},
    		i: function intro(local) {
    			if (current) return;
    			transition_in(if_block);
    			transition_in(footer.$$.fragment, local);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(if_block);
    			transition_out(footer.$$.fragment, local);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div34);
    			if (if_block) if_block.d();
    			destroy_component(footer);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$2.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance$2($$self, $$props, $$invalidate) {
    	let clientName;
    	let completionDate;
    	let subDate;
    	let status;
    	let mappedStatus;
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('SearchResult', slots, []);
    	let { searchResult } = $$props;

    	$$self.$$.on_mount.push(function () {
    		if (searchResult === undefined && !('searchResult' in $$props || $$self.$$.bound[$$self.$$.props['searchResult']])) {
    			console.warn("<SearchResult> was created without expected prop 'searchResult'");
    		}
    	});

    	const writable_props = ['searchResult'];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<SearchResult> was created with unknown prop '${key}'`);
    	});

    	$$self.$$set = $$props => {
    		if ('searchResult' in $$props) $$invalidate(0, searchResult = $$props.searchResult);
    	};

    	$$self.$capture_state = () => ({
    		getClientName,
    		formatDate,
    		getStatus,
    		mapStatus,
    		displayTimeline,
    		Footer,
    		Timeline,
    		searchResult,
    		mappedStatus,
    		status,
    		subDate,
    		completionDate,
    		clientName
    	});

    	$$self.$inject_state = $$props => {
    		if ('searchResult' in $$props) $$invalidate(0, searchResult = $$props.searchResult);
    		if ('mappedStatus' in $$props) $$invalidate(1, mappedStatus = $$props.mappedStatus);
    		if ('status' in $$props) $$invalidate(2, status = $$props.status);
    		if ('subDate' in $$props) $$invalidate(3, subDate = $$props.subDate);
    		if ('completionDate' in $$props) $$invalidate(4, completionDate = $$props.completionDate);
    		if ('clientName' in $$props) $$invalidate(5, clientName = $$props.clientName);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*searchResult*/ 1) {
    			$$invalidate(5, clientName = getClientName(searchResult.clientFirstName));
    		}

    		if ($$self.$$.dirty & /*searchResult*/ 1) {
    			$$invalidate(4, completionDate = formatDate(searchResult.dueDate));
    		}

    		if ($$self.$$.dirty & /*searchResult*/ 1) {
    			$$invalidate(3, subDate = formatDate(searchResult.subDate));
    		}

    		if ($$self.$$.dirty & /*searchResult*/ 1) {
    			$$invalidate(2, status = getStatus(searchResult.jobStatus));
    		}

    		if ($$self.$$.dirty & /*searchResult*/ 1) {
    			$$invalidate(1, mappedStatus = mapStatus(searchResult.jobStatus));
    		}
    	};

    	return [searchResult, mappedStatus, status, subDate, completionDate, clientName];
    }

    class SearchResult extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$2, create_fragment$2, safe_not_equal, { searchResult: 0 });

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "SearchResult",
    			options,
    			id: create_fragment$2.name
    		});
    	}

    	get searchResult() {
    		throw new Error("<SearchResult>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set searchResult(value) {
    		throw new Error("<SearchResult>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}
    }

    /* src\SearchResultMobile.svelte generated by Svelte v3.59.2 */
    const file$1 = "src\\SearchResultMobile.svelte";

    // (46:8) {#if displayTimeline(searchResult.jobStatus)}
    function create_if_block$1(ctx) {
    	let div;
    	let timeline;
    	let current;

    	timeline = new Timeline({
    			props: { currentStatus: /*mappedStatus*/ ctx[1] },
    			$$inline: true
    		});

    	const block = {
    		c: function create() {
    			div = element("div");
    			create_component(timeline.$$.fragment);
    			attr_dev(div, "class", "csa-section-4");
    			add_location(div, file$1, 46, 8, 1921);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div, anchor);
    			mount_component(timeline, div, null);
    			current = true;
    		},
    		p: function update(ctx, dirty) {
    			const timeline_changes = {};
    			if (dirty & /*mappedStatus*/ 2) timeline_changes.currentStatus = /*mappedStatus*/ ctx[1];
    			timeline.$set(timeline_changes);
    		},
    		i: function intro(local) {
    			if (current) return;
    			transition_in(timeline.$$.fragment, local);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(timeline.$$.fragment, local);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div);
    			destroy_component(timeline);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block$1.name,
    		type: "if",
    		source: "(46:8) {#if displayTimeline(searchResult.jobStatus)}",
    		ctx
    	});

    	return block;
    }

    function create_fragment$1(ctx) {
    	let div25;
    	let div17;
    	let div3;
    	let div0;
    	let h10;
    	let t0;
    	let t1;
    	let br;
    	let t2;
    	let t3;
    	let div2;
    	let h11;
    	let t5;
    	let div1;
    	let t6;
    	let t7;
    	let div10;
    	let div6;
    	let div4;
    	let t9;
    	let div5;
    	let t10;
    	let t11;
    	let div9;
    	let div7;
    	let t13;
    	let div8;
    	let t14_value = /*searchResult*/ ctx[0].jobNumber + "";
    	let t14;
    	let t15;
    	let div13;
    	let div11;
    	let t17;
    	let div12;
    	let t18;
    	let t19;
    	let show_if = displayTimeline(/*searchResult*/ ctx[0].jobStatus);
    	let t20;
    	let div16;
    	let div14;
    	let t22;
    	let div15;
    	let t23_value = /*searchResult*/ ctx[0].returnAddress + "";
    	let t23;
    	let t24;
    	let div18;
    	let t25;
    	let div22;
    	let div21;
    	let h12;
    	let t27;
    	let div19;
    	let t28;
    	let div20;
    	let t29_value = /*searchResult*/ ctx[0].serviceDescription + "";
    	let t29;
    	let t30;
    	let div23;
    	let t31;
    	let footer;
    	let t32;
    	let div24;
    	let current;
    	let if_block = show_if && create_if_block$1(ctx);
    	footer = new Footer({ $$inline: true });

    	const block = {
    		c: function create() {
    			div25 = element("div");
    			div17 = element("div");
    			div3 = element("div");
    			div0 = element("div");
    			h10 = element("h1");
    			t0 = text(/*clientName*/ ctx[5]);
    			t1 = space();
    			br = element("br");
    			t2 = text(" Repair");
    			t3 = space();
    			div2 = element("div");
    			h11 = element("h1");
    			h11.textContent = "Due Date";
    			t5 = space();
    			div1 = element("div");
    			t6 = text(/*completionDate*/ ctx[4]);
    			t7 = space();
    			div10 = element("div");
    			div6 = element("div");
    			div4 = element("div");
    			div4.textContent = "Order Placed:";
    			t9 = space();
    			div5 = element("div");
    			t10 = text(/*subDate*/ ctx[3]);
    			t11 = space();
    			div9 = element("div");
    			div7 = element("div");
    			div7.textContent = "Job Number:";
    			t13 = space();
    			div8 = element("div");
    			t14 = text(t14_value);
    			t15 = space();
    			div13 = element("div");
    			div11 = element("div");
    			div11.textContent = "Order Status: ";
    			t17 = space();
    			div12 = element("div");
    			t18 = text(/*status*/ ctx[2]);
    			t19 = space();
    			if (if_block) if_block.c();
    			t20 = space();
    			div16 = element("div");
    			div14 = element("div");
    			div14.textContent = "Return Address:";
    			t22 = space();
    			div15 = element("div");
    			t23 = text(t23_value);
    			t24 = space();
    			div18 = element("div");
    			t25 = space();
    			div22 = element("div");
    			div21 = element("div");
    			h12 = element("h1");
    			h12.textContent = "Artisan Notes";
    			t27 = space();
    			div19 = element("div");
    			t28 = space();
    			div20 = element("div");
    			t29 = text(t29_value);
    			t30 = space();
    			div23 = element("div");
    			t31 = space();
    			create_component(footer.$$.fragment);
    			t32 = space();
    			div24 = element("div");
    			add_location(br, file$1, 24, 57, 853);
    			attr_dev(h10, "class", "csa-text-header");
    			add_location(h10, file$1, 24, 16, 812);
    			attr_dev(div0, "class", "csa-client-name--mobile");
    			add_location(div0, file$1, 23, 12, 757);
    			attr_dev(h11, "class", "csa-text-header");
    			add_location(h11, file$1, 27, 16, 980);
    			attr_dev(div1, "class", "csa-text-completion-date");
    			add_location(div1, file$1, 28, 16, 1039);
    			attr_dev(div2, "class", "csa-layout-vflex csa-completion-date--mobile");
    			add_location(div2, file$1, 26, 12, 904);
    			attr_dev(div3, "class", "csa-layout-hflex csa-section-1");
    			add_location(div3, file$1, 22, 8, 699);
    			attr_dev(div4, "class", "csa-text-regular");
    			add_location(div4, file$1, 33, 16, 1252);
    			attr_dev(div5, "class", "csa-text-bold csa-text-status-detail");
    			add_location(div5, file$1, 34, 16, 1319);
    			add_location(div6, file$1, 32, 12, 1229);
    			attr_dev(div7, "class", "csa-text-regular");
    			add_location(div7, file$1, 37, 16, 1441);
    			attr_dev(div8, "class", "csa-text-bold csa-text-status-detail");
    			add_location(div8, file$1, 38, 16, 1511);
    			add_location(div9, file$1, 36, 12, 1418);
    			attr_dev(div10, "class", "csa-layout-hflex csa-section-status-header csa-section-2");
    			add_location(div10, file$1, 31, 8, 1145);
    			attr_dev(div11, "class", "csa-text-regular");
    			add_location(div11, file$1, 42, 12, 1702);
    			attr_dev(div12, "class", "csa-text-bold csa-text-status-detail");
    			add_location(div12, file$1, 43, 12, 1776);
    			attr_dev(div13, "class", "csa-section-status-text csa-section-3");
    			add_location(div13, file$1, 41, 8, 1637);
    			attr_dev(div14, "class", "csa-text-regular csa-text-return-address");
    			add_location(div14, file$1, 51, 12, 2117);
    			attr_dev(div15, "class", "csa-text-bold csa-text-status-detail");
    			add_location(div15, file$1, 52, 12, 2211);
    			attr_dev(div16, "class", "csa-section-status-header-block csa-section-5");
    			add_location(div16, file$1, 50, 8, 2044);
    			attr_dev(div17, "class", "csa-card csa-layout-vflex");
    			add_location(div17, file$1, 21, 4, 650);
    			attr_dev(div18, "class", "csa-vgap");
    			add_location(div18, file$1, 56, 4, 2331);
    			attr_dev(h12, "class", "csa-text-header csa-section-heading-bottom");
    			add_location(h12, file$1, 60, 12, 2478);
    			attr_dev(div19, "class", "csa-status-line csa-status-line-bottom");
    			add_location(div19, file$1, 61, 12, 2565);
    			attr_dev(div20, "class", "csa-text-bold");
    			add_location(div20, file$1, 62, 12, 2632);
    			attr_dev(div21, "class", "csa-layout-vflex");
    			add_location(div21, file$1, 59, 8, 2434);
    			attr_dev(div22, "class", "csa-card csa-layout-vflex csa-artisan-notes");
    			add_location(div22, file$1, 58, 4, 2367);
    			attr_dev(div23, "class", "csa-vgap");
    			add_location(div23, file$1, 66, 4, 2734);
    			attr_dev(div24, "class", "csa-vgap");
    			add_location(div24, file$1, 70, 4, 2788);
    			attr_dev(div25, "class", "csa-result-container--mobile");
    			add_location(div25, file$1, 20, 0, 602);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div25, anchor);
    			append_dev(div25, div17);
    			append_dev(div17, div3);
    			append_dev(div3, div0);
    			append_dev(div0, h10);
    			append_dev(h10, t0);
    			append_dev(h10, t1);
    			append_dev(h10, br);
    			append_dev(h10, t2);
    			append_dev(div3, t3);
    			append_dev(div3, div2);
    			append_dev(div2, h11);
    			append_dev(div2, t5);
    			append_dev(div2, div1);
    			append_dev(div1, t6);
    			append_dev(div17, t7);
    			append_dev(div17, div10);
    			append_dev(div10, div6);
    			append_dev(div6, div4);
    			append_dev(div6, t9);
    			append_dev(div6, div5);
    			append_dev(div5, t10);
    			append_dev(div10, t11);
    			append_dev(div10, div9);
    			append_dev(div9, div7);
    			append_dev(div9, t13);
    			append_dev(div9, div8);
    			append_dev(div8, t14);
    			append_dev(div17, t15);
    			append_dev(div17, div13);
    			append_dev(div13, div11);
    			append_dev(div13, t17);
    			append_dev(div13, div12);
    			append_dev(div12, t18);
    			append_dev(div17, t19);
    			if (if_block) if_block.m(div17, null);
    			append_dev(div17, t20);
    			append_dev(div17, div16);
    			append_dev(div16, div14);
    			append_dev(div16, t22);
    			append_dev(div16, div15);
    			append_dev(div15, t23);
    			append_dev(div25, t24);
    			append_dev(div25, div18);
    			append_dev(div25, t25);
    			append_dev(div25, div22);
    			append_dev(div22, div21);
    			append_dev(div21, h12);
    			append_dev(div21, t27);
    			append_dev(div21, div19);
    			append_dev(div21, t28);
    			append_dev(div21, div20);
    			append_dev(div20, t29);
    			append_dev(div25, t30);
    			append_dev(div25, div23);
    			append_dev(div25, t31);
    			mount_component(footer, div25, null);
    			append_dev(div25, t32);
    			append_dev(div25, div24);
    			current = true;
    		},
    		p: function update(ctx, [dirty]) {
    			if (!current || dirty & /*clientName*/ 32) set_data_dev(t0, /*clientName*/ ctx[5]);
    			if (!current || dirty & /*completionDate*/ 16) set_data_dev(t6, /*completionDate*/ ctx[4]);
    			if (!current || dirty & /*subDate*/ 8) set_data_dev(t10, /*subDate*/ ctx[3]);
    			if ((!current || dirty & /*searchResult*/ 1) && t14_value !== (t14_value = /*searchResult*/ ctx[0].jobNumber + "")) set_data_dev(t14, t14_value);
    			if (!current || dirty & /*status*/ 4) set_data_dev(t18, /*status*/ ctx[2]);
    			if (dirty & /*searchResult*/ 1) show_if = displayTimeline(/*searchResult*/ ctx[0].jobStatus);

    			if (show_if) {
    				if (if_block) {
    					if_block.p(ctx, dirty);

    					if (dirty & /*searchResult*/ 1) {
    						transition_in(if_block, 1);
    					}
    				} else {
    					if_block = create_if_block$1(ctx);
    					if_block.c();
    					transition_in(if_block, 1);
    					if_block.m(div17, t20);
    				}
    			} else if (if_block) {
    				group_outros();

    				transition_out(if_block, 1, 1, () => {
    					if_block = null;
    				});

    				check_outros();
    			}

    			if ((!current || dirty & /*searchResult*/ 1) && t23_value !== (t23_value = /*searchResult*/ ctx[0].returnAddress + "")) set_data_dev(t23, t23_value);
    			if ((!current || dirty & /*searchResult*/ 1) && t29_value !== (t29_value = /*searchResult*/ ctx[0].serviceDescription + "")) set_data_dev(t29, t29_value);
    		},
    		i: function intro(local) {
    			if (current) return;
    			transition_in(if_block);
    			transition_in(footer.$$.fragment, local);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(if_block);
    			transition_out(footer.$$.fragment, local);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div25);
    			if (if_block) if_block.d();
    			destroy_component(footer);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$1.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance$1($$self, $$props, $$invalidate) {
    	let clientName;
    	let completionDate;
    	let subDate;
    	let status;
    	let mappedStatus;
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('SearchResultMobile', slots, []);
    	let { searchResult } = $$props;

    	$$self.$$.on_mount.push(function () {
    		if (searchResult === undefined && !('searchResult' in $$props || $$self.$$.bound[$$self.$$.props['searchResult']])) {
    			console.warn("<SearchResultMobile> was created without expected prop 'searchResult'");
    		}
    	});

    	const writable_props = ['searchResult'];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<SearchResultMobile> was created with unknown prop '${key}'`);
    	});

    	$$self.$$set = $$props => {
    		if ('searchResult' in $$props) $$invalidate(0, searchResult = $$props.searchResult);
    	};

    	$$self.$capture_state = () => ({
    		getClientName,
    		formatDate,
    		getStatus,
    		mapStatus,
    		displayTimeline,
    		Footer,
    		Timeline,
    		searchResult,
    		mappedStatus,
    		status,
    		subDate,
    		completionDate,
    		clientName
    	});

    	$$self.$inject_state = $$props => {
    		if ('searchResult' in $$props) $$invalidate(0, searchResult = $$props.searchResult);
    		if ('mappedStatus' in $$props) $$invalidate(1, mappedStatus = $$props.mappedStatus);
    		if ('status' in $$props) $$invalidate(2, status = $$props.status);
    		if ('subDate' in $$props) $$invalidate(3, subDate = $$props.subDate);
    		if ('completionDate' in $$props) $$invalidate(4, completionDate = $$props.completionDate);
    		if ('clientName' in $$props) $$invalidate(5, clientName = $$props.clientName);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*searchResult*/ 1) {
    			$$invalidate(5, clientName = getClientName(searchResult.clientFirstName));
    		}

    		if ($$self.$$.dirty & /*searchResult*/ 1) {
    			$$invalidate(4, completionDate = formatDate(searchResult.dueDate));
    		}

    		if ($$self.$$.dirty & /*searchResult*/ 1) {
    			$$invalidate(3, subDate = formatDate(searchResult.subDate));
    		}

    		if ($$self.$$.dirty & /*searchResult*/ 1) {
    			$$invalidate(2, status = getStatus(searchResult.jobStatus));
    		}

    		if ($$self.$$.dirty & /*searchResult*/ 1) {
    			$$invalidate(1, mappedStatus = mapStatus(searchResult.jobStatus));
    		}
    	};

    	return [searchResult, mappedStatus, status, subDate, completionDate, clientName];
    }

    class SearchResultMobile extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$1, create_fragment$1, safe_not_equal, { searchResult: 0 });

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "SearchResultMobile",
    			options,
    			id: create_fragment$1.name
    		});
    	}

    	get searchResult() {
    		throw new Error("<SearchResultMobile>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set searchResult(value) {
    		throw new Error("<SearchResultMobile>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}
    }

    /* src\App.svelte generated by Svelte v3.59.2 */
    const file = "src\\App.svelte";

    // (16:1) {#if searchResult.count > 0 }
    function create_if_block(ctx) {
    	let searchdetailmobile;
    	let t;
    	let searchdetail;
    	let current;

    	searchdetailmobile = new SearchResultMobile({
    			props: { searchResult: /*searchResult*/ ctx[0] },
    			$$inline: true
    		});

    	searchdetail = new SearchResult({
    			props: { searchResult: /*searchResult*/ ctx[0] },
    			$$inline: true
    		});

    	const block = {
    		c: function create() {
    			create_component(searchdetailmobile.$$.fragment);
    			t = space();
    			create_component(searchdetail.$$.fragment);
    		},
    		m: function mount(target, anchor) {
    			mount_component(searchdetailmobile, target, anchor);
    			insert_dev(target, t, anchor);
    			mount_component(searchdetail, target, anchor);
    			current = true;
    		},
    		p: function update(ctx, dirty) {
    			const searchdetailmobile_changes = {};
    			if (dirty & /*searchResult*/ 1) searchdetailmobile_changes.searchResult = /*searchResult*/ ctx[0];
    			searchdetailmobile.$set(searchdetailmobile_changes);
    			const searchdetail_changes = {};
    			if (dirty & /*searchResult*/ 1) searchdetail_changes.searchResult = /*searchResult*/ ctx[0];
    			searchdetail.$set(searchdetail_changes);
    		},
    		i: function intro(local) {
    			if (current) return;
    			transition_in(searchdetailmobile.$$.fragment, local);
    			transition_in(searchdetail.$$.fragment, local);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(searchdetailmobile.$$.fragment, local);
    			transition_out(searchdetail.$$.fragment, local);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			destroy_component(searchdetailmobile, detaching);
    			if (detaching) detach_dev(t);
    			destroy_component(searchdetail, detaching);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block.name,
    		type: "if",
    		source: "(16:1) {#if searchResult.count > 0 }",
    		ctx
    	});

    	return block;
    }

    function create_fragment(ctx) {
    	let div;
    	let searchbar;
    	let t;
    	let current;
    	searchbar = new SearchBar({ $$inline: true });
    	searchbar.$on("onSearch", /*onSearch*/ ctx[1]);
    	let if_block = /*searchResult*/ ctx[0].count > 0 && create_if_block(ctx);

    	const block = {
    		c: function create() {
    			div = element("div");
    			create_component(searchbar.$$.fragment);
    			t = space();
    			if (if_block) if_block.c();
    			attr_dev(div, "class", "carousel-search-app-container");
    			add_location(div, file, 13, 0, 323);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div, anchor);
    			mount_component(searchbar, div, null);
    			append_dev(div, t);
    			if (if_block) if_block.m(div, null);
    			current = true;
    		},
    		p: function update(ctx, [dirty]) {
    			if (/*searchResult*/ ctx[0].count > 0) {
    				if (if_block) {
    					if_block.p(ctx, dirty);

    					if (dirty & /*searchResult*/ 1) {
    						transition_in(if_block, 1);
    					}
    				} else {
    					if_block = create_if_block(ctx);
    					if_block.c();
    					transition_in(if_block, 1);
    					if_block.m(div, null);
    				}
    			} else if (if_block) {
    				group_outros();

    				transition_out(if_block, 1, 1, () => {
    					if_block = null;
    				});

    				check_outros();
    			}
    		},
    		i: function intro(local) {
    			if (current) return;
    			transition_in(searchbar.$$.fragment, local);
    			transition_in(if_block);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(searchbar.$$.fragment, local);
    			transition_out(if_block);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div);
    			destroy_component(searchbar);
    			if (if_block) if_block.d();
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('App', slots, []);
    	let searchResult = { count: 0 };

    	function onSearch(event) {
    		$$invalidate(0, searchResult = { count: 0 });
    		$$invalidate(0, searchResult = event.detail);
    	}

    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<App> was created with unknown prop '${key}'`);
    	});

    	$$self.$capture_state = () => ({
    		SearchBar,
    		SearchDetail: SearchResult,
    		SearchDetailMobile: SearchResultMobile,
    		searchResult,
    		onSearch
    	});

    	$$self.$inject_state = $$props => {
    		if ('searchResult' in $$props) $$invalidate(0, searchResult = $$props.searchResult);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	return [searchResult, onSearch];
    }

    class App extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance, create_fragment, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "App",
    			options,
    			id: create_fragment.name
    		});
    	}
    }

    const app = new App({
    	target: document.getElementById('carousel-search-app')
    });

    return app;

})();
//# sourceMappingURL=bundle.js.map
