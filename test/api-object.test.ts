import { Construct } from 'constructs';
import { ApiObject, Chart, JsonPatch, Testing } from '../src';

test('minimal configuration', () => {
  const app = Testing.app();
  const stack = new Chart(app, 'test');

  new ApiObject(stack, 'my-resource', {
    apiVersion: 'v1',
    kind: 'MyResource',
  });

  expect(Testing.synth(stack)).toMatchSnapshot();
});

test('printed yaml is alphabetical', () => {
  const app = Testing.app();
  const stack = new Chart(app, 'test');

  // Object keys in random order
  new ApiObject(stack, 'my-resource', {
    kind: 'MyResource',
    spec: {
      secondProperty: {
        innerThirdProperty: '!',
        beforeThirdProperty: 'world',
      },
      firstProperty: 'hello',
    },
    metadata: {
      meta: {
        zzz: 'hello',
        aaa: 123,
      },
    },
    apiVersion: 'v1',
  });

  // Should match alphabetically-ordered snapshot (we snapshot the string
  // because jest snapshots treat dictionaries as unordered)
  expect(JSON.stringify(Testing.synth(stack), undefined, 2)).toMatchSnapshot();
});

test('the CDK8S_DISABLE_SORT environment variable can be used to disable key sorting', () => {
  const obj = new ApiObject(Testing.chart(), 'my-api-object', {
    apiVersion: 'v1',
    kind: 'Dummy',
    hello: {
      zzz: 123,
      aaa: 333,
      nested: {
        yyy: 'hello',
        bbb: 123,
      },
    },
  });

  // default behavior - sorted
  expect(JSON.stringify(obj.toJson())).toStrictEqual('{"apiVersion":"v1","kind":"Dummy","metadata":{"name":"test-my-api-object-c8e6fbed"},"hello":{"aaa":333,"nested":{"bbb":123,"yyy":"hello"},"zzz":123}}');

  // with CDK8S_DISABLE_SORT set at the chart level
  process.env.CDK8S_DISABLE_SORT = '1';
  try {
    expect(JSON.stringify(obj.toJson())).toStrictEqual('{"apiVersion":"v1","kind":"Dummy","metadata":{"name":"test-my-api-object-c8e6fbed"},"hello":{"zzz":123,"aaa":333,"nested":{"yyy":"hello","bbb":123}}}');
  } finally {
    delete process.env.CDK8S_DISABLE_SORT;
  }
});

test('addDependency', () => {

  const app = Testing.app();
  const chart = new Chart(app, 'chart1');

  const obj1 = new ApiObject(chart, 'obj1', { apiVersion: 'v1', kind: 'Kind1' });
  const obj2 = new ApiObject(chart, 'obj2', { apiVersion: 'v1', kind: 'Kind2' });
  const obj3 = new ApiObject(chart, 'obj3', { apiVersion: 'v1', kind: 'Kind3' });

  obj1.addDependency(obj2, obj3);

  const dependencies = obj1.node.dependencies;

  expect(dependencies).toEqual([
    obj2,
    obj3,
  ]);

});

test('synthesized resource name is based on path', () => {
  // GIVEN
  const app = Testing.app();
  const stack = new Chart(app, 'test');
  new ApiObject(stack, 'my-resource', {
    apiVersion: 'v1',
    kind: 'MyResource',
  });

  // WHEN
  // now create another resource with the same namespace but within a sub-scope
  const scope = new Construct(stack, 'scope');
  new ApiObject(scope, 'my-resource', {
    apiVersion: 'v1',
    kind: 'MyResource',
  });

  // THEN
  expect(Testing.synth(stack)).toMatchSnapshot();
});

test('if name is explicitly specified it will be respected', () => {
  // GIVEN
  const app = Testing.app();
  const stack = new Chart(app, 'test');

  // WHEN
  new ApiObject(stack, 'my-resource', {
    kind: 'MyResource',
    apiVersion: 'v1',
    metadata: {
      name: 'boom',
    },
  });

  // THEN
  expect(Testing.synth(stack)).toMatchSnapshot();
});

test('"spec" is synthesized as-is', () => {
  // GIVEN
  const app = Testing.app();
  const stack = new Chart(app, 'test');

  // WHEN
  new ApiObject(stack, 'resource', {
    kind: 'ResourceType',
    apiVersion: 'v1',
    spec: {
      prop1: 'hello',
      prop2: {
        world: 123,
      },
    },
  });

  // THEN
  expect(Testing.synth(stack)).toMatchSnapshot();
});

test('"data" can be used to specify resource data', () => {
  // GIVEN
  const app = Testing.app();
  const stack = new Chart(app, 'test');

  // WHEN
  new ApiObject(stack, 'resource', {
    kind: 'ResourceType',
    apiVersion: 'v1',
    data: {
      boom: 123,
    },
  });

  // THEN
  expect(Testing.synth(stack)).toMatchSnapshot();
});

test('object naming logic can be overridden at the chart level', () => {
  class MyChart extends Chart {
    generateObjectName() {
      return 'fixed!';
    }
  }

  // GIVEN
  const app = Testing.app();
  const chart = new MyChart(app, 'my-chart');

  // WHEN
  const object = new ApiObject(chart, 'my-object', {
    apiVersion: 'v1',
    kind: 'MyKind',
  });

  // THEN
  expect(object.name).toEqual('fixed!');
  expect(Testing.synth(chart)).toStrictEqual([{
    apiVersion: 'v1',
    kind: 'MyKind',
    metadata: { name: 'fixed!' },
  }]);
});

test('default namespace can be defined at the chart level', () => {
  // GIVEN
  const app = Testing.app();
  const chart = new Chart(app, 'chart', { namespace: 'ns1' });
  const group1 = new Construct(chart, 'group1');

  // WHEN
  new ApiObject(group1, 'obj1', { apiVersion: 'v1', kind: 'Kind1' });
  new ApiObject(group1, 'obj2', { apiVersion: 'v2', kind: 'Kind2', metadata: { namespace: 'foobar' } });

  // THEN
  expect(Testing.synth(chart)).toStrictEqual([{
    apiVersion: 'v1',
    kind:
    'Kind1',
    metadata: {
      name: 'chart-group1-obj1-c885aeec',
      namespace: 'ns1',
    },
  }, {
    apiVersion: 'v2',
    kind: 'Kind2',
    metadata: {
      name: 'chart-group1-obj2-c81931d8',
      namespace: 'foobar',
    },
  }]);
});

test('chart labels are applied to all api objects in the chart', () => {
  // GIVEN
  const app = Testing.app();

  // WHEN
  const chart = new Chart(app, 'my-chart', {
    labels: {
      foo: 'ffffffffff',
      bar: 'bbbbbb',
    },
  });

  new ApiObject(chart, 'obj1', { kind: 'Obj1', apiVersion: 'v1' });
  const group = new Construct(chart, 'group');
  new ApiObject(group, 'obj2', {
    kind: 'Obj2',
    apiVersion: 'v2',
    metadata: {
      labels: {
        foo: 'override by object',
        zoo: 'zoo1',
      },
    },
  });

  // THEN
  expect(Testing.synth(chart)).toEqual([
    {
      apiVersion: 'v1',
      kind: 'Obj1',
      metadata: {
        labels: {
          bar: 'bbbbbb',
          foo: 'ffffffffff',
        },
        name: 'my-chart-obj1-c880bc50',
      },
    },
    {
      apiVersion: 'v2',
      kind: 'Obj2',
      metadata: {
        labels: {
          bar: 'bbbbbb',
          foo: 'override by object',
          zoo: 'zoo1',
        },
        name: 'my-chart-group-obj2-c824cfcd',
      },
    },
  ]);
});

describe('ApiObject.of()', () => {

  test('fails if there is no default child', () => {
    // GIVEN
    const chart = Testing.chart();

    // THEN
    expect(() => ApiObject.of(new Construct(chart, 'hello'))).toThrow(/cannot find a \(direct or indirect\) child of type ApiObject/);
  });

  test('returns the object if it is an API object', () => {
    // GIVEN
    const chart = Testing.chart();
    const obj = new ApiObject(chart, 'my-obj', { apiVersion: 'v1', kind: 'Foo' });

    // THEN
    expect(ApiObject.of(obj)).toBe(obj);
  });

  test('returns a direct child', () => {
    // GIVEN
    const chart = Testing.chart();
    const parent = new Construct(chart, 'l2');

    // WHEN
    const obj = new ApiObject(parent, 'Default', { apiVersion: 'v1', kind: 'Foo' });

    // THEN
    expect(ApiObject.of(parent)).toBe(obj);
  });

  test('returns an indirect child', () => {
    // GIVEN
    const chart = Testing.chart();
    const parent1 = new Construct(chart, 'l3');

    // WHEN
    const parent2 = new Construct(parent1, 'Default');
    const obj = new ApiObject(parent2, 'Default', { apiVersion: 'v1', kind: 'Foo' });

    // THEN
    expect(ApiObject.of(parent1)).toBe(obj);
  });

});

describe('addJsonPatch()', () => {

  test('applied after the object has been synthesized', () => {
    // GIVEN
    const chart = Testing.chart();
    const obj = new ApiObject(chart, 'obj', {
      kind: 'Obj',
      apiVersion: 'v1',
      spec: {
        foo: 1234,
        bar: {
          baz: [1, 2, 3],
        },
      },
    });

    // WHEN
    obj.addJsonPatch(JsonPatch.add('/spec/bar/baz/3', 4));
    obj.addJsonPatch(JsonPatch.remove('/spec/foo'));
    obj.addJsonPatch(JsonPatch.copy('/apiVersion', '/spec/apiVersion'));

    // THEN
    expect(Testing.synth(chart)).toStrictEqual([
      {
        apiVersion: 'v1',
        kind: 'Obj',
        metadata: {
          name: 'test-obj-c8686f96',
        },
        spec: {
          apiVersion: 'v1',
          bar: {
            baz: [1, 2, 3, 4],
          },
        },
      },
    ]);
  });

});
