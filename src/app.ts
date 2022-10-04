import * as fs from 'fs';
import * as path from 'path';
import { Construct, Node, IConstruct } from 'constructs';
import { ApiObject } from './api-object';
import { Chart } from './chart';
import { DependencyGraph } from './dependency';
import { Names } from './names';
import { Yaml } from './yaml';

/** The method to divide YAML output into files */
export enum YamlOutputType {
  /** All resources are output into a single YAML file */
  FILE_PER_APP,
  /** Resources are split into seperate files by chart */
  FILE_PER_CHART,
  /** Each resource is output to its own file */
  FILE_PER_RESOURCE,
  /** Each chart in its own folder and each resource in its own file */
  FOLDER_PER_CHART_FILE_PER_RESOURCE,
}

export interface AppProps {
  /**
   * The directory to output Kubernetes manifests.
   *
   * If you synthesize your application using `cdk8s synth`, you must
   * also pass this value to the CLI using the `--output` option or
   * the `output` property in the `cdk8s.yaml` configuration file.
   * Otherwise, the CLI will not know about the output directory,
   * and synthesis will fail.
   *
   * This property is intended for internal and testing use.
   *
   * @default - CDK8S_OUTDIR if defined, otherwise "dist"
   */
  readonly outdir?: string;
  /**
   *  The file extension to use for rendered YAML files
   * @default .k8s.yaml
   */
  readonly outputFileExtension?: string;
  /**
   *  How to divide the YAML output into files
   * @default YamlOutputType.FILE_PER_CHART
   */
  readonly yamlOutputType?: YamlOutputType;

  /**
   * When set to true, the output directory will contain a `construct-metadata.json` file
   * that holds construct related metadata on every resource in the app.
   *
   * @default false
   */
  readonly recordConstructMetadata?: boolean;
}

/**
 * Represents a cdk8s application.
 */
export class App extends Construct {
  /**
   * Synthesize a single chart.
   *
   * Each element returned in the resulting array represents a different ApiObject
   * in the scope of the chart.
   *
   * Note that the returned array order is important. It is determined by the various dependencies between
   * the constructs in the chart, where the first element is the one without dependencies, and so on...
   *
   * @returns An array of JSON objects.
   * @param chart the chart to synthesize.
   * @internal
   */
  public static _synthChart(chart: Chart): any[] {

    const app: App = App.of(chart);

    // we must prepare the entire app before synthesizing the chart
    // because the dependency inference happens on the app level.
    resolveDependencies(app);

    // validate the app since we want to call onValidate of the relevant constructs.
    // note this will also call onValidate on constructs from possibly different charts,
    // but thats ok too since we no longer treat constructs as a self-contained synthesis unit.
    validate(app);

    return chartToKube(chart).map(obj => obj.toJson());
  }

  private static of(c: IConstruct): App {

    const scope = Node.of(c).scope;

    if (!scope) {
      // the app is the only construct without a scope.
      return c as App;
    }

    return App.of(scope);
  }

  /**
   * The output directory into which manifests will be synthesized.
   */
  public readonly outdir: string;

  /**
   *  The file extension to use for rendered YAML files
   * @default .k8s.yaml
   */
  public readonly outputFileExtension: string;

  /** How to divide the YAML output into files
   * @default YamlOutputType.FILE_PER_CHART
   */
  public readonly yamlOutputType: YamlOutputType;

  private readonly recordConstructMetadata: boolean;

  /**
   * Returns all the charts in this app, sorted topologically.
   */
  public get charts(): Chart[] {
    const isChart = (x: IConstruct): x is Chart => x instanceof Chart;
    return new DependencyGraph(Node.of(this))
      .topology()
      .filter(isChart);
  }

  /**
   * Defines an app
   * @param props configuration options
   */
  constructor(props: AppProps = { }) {
    super(undefined as any, '');
    this.outdir = props.outdir ?? process.env.CDK8S_OUTDIR ?? 'dist';
    this.outputFileExtension = props.outputFileExtension ?? '.k8s.yaml';
    this.yamlOutputType = props.yamlOutputType ?? YamlOutputType.FILE_PER_CHART;

    this.recordConstructMetadata = props.recordConstructMetadata ?? (process.env.CDK8S_RECORD_CONSTRUCT_METADATA === 'true' ? true : false);

  }

  /**
   * Synthesizes all manifests to the output directory
   */
  public synth(): void {

    fs.mkdirSync(this.outdir, { recursive: true });

    // Since we plan on removing the distributed synth mechanism, we no longer call `Node.synthesize`, but rather simply implement
    // the necessary operations. We do however want to preserve the distributed validation.
    validate(this);

    // this is kind of sucky, eventually I would like the DependencyGraph
    // to be able to answer this question.
    const hasDependantCharts = resolveDependencies(this);
    const charts = this.charts;

    switch (this.yamlOutputType) {
      case YamlOutputType.FILE_PER_APP:
        let apiObjectList: ApiObject[] = [];

        for (const chart of charts) {
          apiObjectList.push(...chartToKube(chart));
        }

        if (charts.length > 0) {
          Yaml.save(
            path.join(this.outdir, `app${this.outputFileExtension}`), // There is no "app name", so we just hardcode the file name
            apiObjectList.map((apiObject) => apiObject.toJson()),
          );
        }
        break;

      case YamlOutputType.FILE_PER_CHART:
        const namer: ChartNamer = hasDependantCharts ? new IndexedChartNamer() : new SimpleChartNamer();
        for (const chart of charts) {
          const chartName = namer.name(chart);
          const objects = chartToKube(chart);
          Yaml.save(path.join(this.outdir, chartName+this.outputFileExtension), objects.map(obj => obj.toJson()));
        }
        break;

      case YamlOutputType.FILE_PER_RESOURCE:
        for (const chart of charts) {
          const apiObjects = chartToKube(chart);

          apiObjects.forEach((apiObject) => {
            if (!(apiObject === undefined)) {
              const fileName = `${`${apiObject.kind}.${apiObject.metadata.name}`
                .replace(/[^0-9a-zA-Z-_.]/g, '')}`;
              Yaml.save(path.join(this.outdir, fileName+this.outputFileExtension), [apiObject.toJson()]);
            }
          });
        }
        break;

      case YamlOutputType.FOLDER_PER_CHART_FILE_PER_RESOURCE:
        const folderNamer: ChartNamer = hasDependantCharts ? new IndexedChartFolderNamer() : new SimpleChartFolderNamer();
        for (const chart of charts) {
          const chartName = folderNamer.name(chart);
          const apiObjects = chartToKube(chart);
          const fullOutDir = path.join(this.outdir, chartName);
          fs.mkdirSync(fullOutDir, { recursive: true });

          apiObjects.forEach((apiObject) => {
            if (!(apiObject === undefined)) {
              const fileName = `${`${apiObject.kind}.${apiObject.metadata.name}`
                .replace(/[^0-9a-zA-Z-_.]/g, '')}`;
              Yaml.save(path.join(fullOutDir, fileName+this.outputFileExtension), [apiObject.toJson()]);
            }
          });
        }
        break;

      default:
        break;
    }

    if (this.recordConstructMetadata) {
      const allObjects = this.charts.flatMap(chartToKube);
      this.writeConstructMetadata(allObjects);
    }

  }

  /**
   * Synthesizes the app into a YAML string.
   *
   * @returns A string with all YAML objects across all charts in this app.
   */
  public synthYaml(): any {
    validate(this);

    const charts = this.charts;
    const docs: any[] = [];

    for (const chart of charts) {
      const apiObjects = chartToKube(chart);
      docs.push(...apiObjects.map(apiObject => apiObject.toJson()));
    }

    return Yaml.stringify(...docs);
  }

  private writeConstructMetadata(apiObjects: ApiObject[]) {
    const resources: { [key: string]: any } = {};
    for (const apiObject of apiObjects) {
      resources[apiObject.name] = { path: Node.of(apiObject).path };
    }
    fs.writeFileSync(path.join(this.outdir, 'construct-metadata.json'), JSON.stringify({
      version: '1.0.0',
      resources: resources,
    }));
  }
}

function validate(app: App) {

  // Note this is a copy-paste of https://github.com/aws/constructs/blob/master/lib/construct.ts#L438.
  const errors = Node.of(app).validate();
  if (errors.length > 0) {
    const errorList = errors.map(e => `[${Node.of(e.source).path}] ${e.message}`).join('\n  ');
    throw new Error(`Validation failed with the following errors:\n  ${errorList}`);
  }

}

function resolveDependencies(app: App) {

  let hasDependantCharts = false;

  for (const dep of Node.of(app).dependencies) {

    // create explicit api object dependencies from implicit construct dependencies
    const targetApiObjects = Node.of(dep.target).findAll().filter(c => c instanceof ApiObject);
    const sourceApiObjects = Node.of(dep.source).findAll().filter(c => c instanceof ApiObject);

    for (const target of targetApiObjects) {
      for (const source of sourceApiObjects) {
        if (target !== source) {
          Node.of(source).addDependency(target);
        }
      }
    }

    // create an explicit chart dependency from implicit construct dependencies
    const sourceChart = Chart.of(dep.source);
    const targetChart = Chart.of(dep.target);

    if (sourceChart !== targetChart) {
      Node.of(sourceChart).addDependency(targetChart);
      hasDependantCharts = true;
    }

  }

  const charts = new DependencyGraph(Node.of(app)).topology()
    .filter(x => x instanceof Chart);

  for (const parentChart of charts) {
    for (const childChart of Node.of(parentChart).children.filter(x => x instanceof Chart)) {
      // create an explicit chart dependency from nested chart relationships
      Node.of(parentChart).addDependency(childChart);
      hasDependantCharts = true;
    }
  }

  return hasDependantCharts;

}

function chartToKube(chart: Chart) {
  return new DependencyGraph(Node.of(chart)).topology()
    .filter(x => x instanceof ApiObject)
    .filter(x => Chart.of(x) === chart) // include an object only in its closest parent chart
    .map(x => (x as ApiObject));
}

interface ChartNamer {
  name(chart: Chart): string;
}

class SimpleChartNamer implements ChartNamer {
  constructor() {
  }

  public name(chart: Chart) {
    return `${Names.toDnsLabel(chart)}`;
  }
}

class IndexedChartNamer extends SimpleChartNamer implements ChartNamer {
  private index: number = 0;
  constructor() {
    super();
  }

  public name(chart: Chart) {
    const name = `${this.index.toString().padStart(4, '0')}-${super.name(chart)}`;
    this.index++;
    return name;
  }
}

class SimpleChartFolderNamer implements ChartNamer {
  constructor() {
  }

  public name(chart: Chart) {
    return Names.toDnsLabel(chart);
  }
}

class IndexedChartFolderNamer extends SimpleChartFolderNamer implements ChartNamer {
  private index: number = 0;
  constructor() {
    super();
  }

  public name(chart: Chart) {
    const name = `${this.index.toString().padStart(4, '0')}-${super.name(chart)}`;
    this.index++;
    return name;
  }
}