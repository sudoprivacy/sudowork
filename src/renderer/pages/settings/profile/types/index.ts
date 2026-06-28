export type UserAvatarRecord = { type: 'preset'; value: 'boy' | 'girl' } | { type: 'generated'; localPath: string };

export type AvatarGenState = 'idle' | 'generating' | 'result' | 'error';

export interface IGeneratedAvatarResult {
  localPath: string;
  dataUrl: string;
}

export interface IEChartsTooltipParam {
  dataIndex: number;
  seriesName: string;
  value: number;
}

export interface IChartSeries {
  name: string;
  type: string;
  stack: string;
  color: string;
  data: number[];
}

export interface IPointChartSeries extends IChartSeries {
  barMaxWidth: number;
}

export interface IModelUsageChartData {
  dates: string[];
  models: string[];
  series: IChartSeries[];
  pointSeries: IPointChartSeries[];
  totals: number[];
  pointTotals: number[];
  dateMap: Map<string, Map<string, number>>;
  pointDateMap: Map<string, Map<string, number>>;
}
