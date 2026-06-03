import { DatePicker, Spin, Message } from '@arco-design/web-react';
import ReactECharts from 'echarts-for-react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import { useModelUsageStats } from '@/renderer/hooks/useModelUsageStats';
import { formatUsagePoints, tokensToUsagePoints } from '@/common/tokenUsage';

const { RangePicker } = DatePicker;

const CHART_COLORS = [
  '#7583b2', // aou-6 (品牌色)
  '#165dff', // primary
  '#00b42a', // success
  '#ff7d00', // warning
  '#596590', // aou-7
  '#3f4868', // aou-8
  '#f53f3f', // danger
  '#b5bcd6', // aou-4
];

interface EChartsTooltipParam {
  dataIndex: number;
  seriesName: string;
  value: number;
}

interface WeeklyModelUsageChartProps {
  className?: string;
}

const WeeklyModelUsageChart: React.FC<WeeklyModelUsageChartProps> = ({ className }) => {
  const { t } = useTranslation();
  const { data, loading, error, fetchStats } = useModelUsageStats();

  const [dateRange, setDateRange] = useState<[Date, Date]>(() => {
    const today = new Date();
    const weekAgo = new Date(today);
    weekAgo.setDate(today.getDate() - 7);
    return [weekAgo, today];
  });

  useEffect(() => {
    const startDate = dayjs(dateRange[0]).format('YYYY-MM-DD');
    const endDate = dayjs(dateRange[1]).format('YYYY-MM-DD');
    void fetchStats(startDate, endDate);
  }, [dateRange, fetchStats]);

  useEffect(() => {
    if (error) {
      Message.error(t('settings.modelUsage.loadFailed') || '加载模型用量数据失败');
    }
  }, [error, t]);

  interface ChartDataResult {
    dates: string[];
    models: string[];
    series: { name: string; type: string; stack: string; color: string; data: number[] }[];
    totals: number[];
    pointTotals: number[];
    dateMap: Map<string, Map<string, number>>;
  }

  const chartData = useMemo<ChartDataResult>(() => {
    if (!data.length) return { dates: [], models: [], series: [], totals: [], pointTotals: [], dateMap: new Map() };

    const dateMap = new Map<string, Map<string, number>>();
    const modelsSet = new Set<string>();

    for (const item of data) {
      modelsSet.add(item.model);
      if (!dateMap.has(item.date)) {
        dateMap.set(item.date, new Map());
      }
      const modelData = dateMap.get(item.date)!;
      modelData.set(item.model, (modelData.get(item.model) || 0) + item.total_tokens);
    }

    const dates = Array.from(dateMap.keys()).sort();
    const models = Array.from(modelsSet);

    // 计算每天的总用量
    const totals = dates.map((date) => {
      const modelData = dateMap.get(date)!;
      let sum = 0;
      modelData.forEach((v) => (sum += v));
      return sum;
    });
    const pointTotals = totals.map((total) => tokensToUsagePoints(total) ?? 0);

    // 计算每个模型的总用量，用于排序（大用量放底部，小用量放顶部更显眼）
    const modelTotals = new Map<string, number>();
    models.forEach((model) => {
      let sum = 0;
      dates.forEach((date) => {
        const modelData = dateMap.get(date);
        sum += modelData?.get(model) || 0;
      });
      modelTotals.set(model, sum);
    });

    // 按总用量排序：大用量在前（底部），小用量在后（顶部）
    const sortedModels = models.sort((a, b) => (modelTotals.get(b) || 0) - (modelTotals.get(a) || 0));

    // 计算绝对值数据，小数值设置最小可见高度（当天总量的 5%）
    const MIN_PERCENT = 5;
    const series = sortedModels.map((model, index) => ({
      name: model,
      type: 'bar',
      stack: 'total',
      color: CHART_COLORS[index % CHART_COLORS.length],
      data: dates.map((date, dateIndex) => {
        const modelData = dateMap.get(date);
        const value = modelData?.get(model) || 0;
        const total = totals[dateIndex];
        if (value === 0) return 0;
        // 如果占比小于最小百分比，设置最小可见高度（总量的 5%）
        const minValue = total * (MIN_PERCENT / 100);
        return Math.max(value, minValue);
      }),
    }));

    return { dates, models: sortedModels, series, totals, pointTotals, dateMap };
  }, [data]);

  const modelChartOption = useMemo(() => {
    const getCSSVar = (name: string) => {
      const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return value || '#1d2129';
    };

    // 使用 dateMap 获取原始数值，用于 tooltip
    const rawData = chartData.dates.map((date, dateIndex) => {
      const dayModelData = chartData.dateMap.get(date);
      const dayData: Record<string, number> = {};
      chartData.models.forEach((model) => {
        dayData[model] = dayModelData?.get(model) || 0;
      });
      return { date, total: chartData.totals[dateIndex], models: dayData };
    });

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: getCSSVar('--fill-0') || '#ffffff',
        borderColor: getCSSVar('--border-base') || '#e5e6eb',
        textStyle: { color: getCSSVar('--text-primary') || '#1d2129', fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif' },
        formatter: (params: EChartsTooltipParam[]) => {
          if (!params || !params.length) return '';
          const dataIndex = params[0].dataIndex;
          const dayRaw = rawData[dataIndex];
          const date = dayRaw.date;
          const total = dayRaw.total;
          const items = params
            .filter((p) => p.value > 0)
            .map((p) => {
              const rawValue = dayRaw.models[p.seriesName] || 0;
              const percent = total > 0 ? ((rawValue / total) * 100).toFixed(1) : '0';
              return `<div style="display:flex;justify-content:space-between;gap:12px"><span>${p.seriesName}</span><span style="font-weight:600">${percent}% (${rawValue.toLocaleString()})</span></div>`;
            })
            .join('');
          return `<div style="font-weight:600;margin-bottom:8px">${date}</div>${items}<div style="display:flex;justify-content:space-between;gap:12px;margin-top:8px;border-top:1px solid var(--border-base);padding-top:8px"><span>${t('settings.modelUsage.total')}</span><span style="font-weight:600">${total.toLocaleString()}</span></div>`;
        },
      },
      legend: {
        show: chartData.models.length > 1,
        top: 0,
        textStyle: { color: getCSSVar('--text-secondary') || '#86909c', fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif' },
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '3%',
        top: chartData.models.length > 1 ? '40px' : '20px',
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: chartData.dates.map((d) => dayjs(d).format('MM-DD')),
        axisLabel: { color: getCSSVar('--text-secondary') || '#86909c', fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif' },
        axisLine: { lineStyle: { color: getCSSVar('--border-base') || '#e5e6eb' } },
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          color: getCSSVar('--text-secondary') || '#86909c',
          fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif',
          formatter: (value: number) => {
            if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
            if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
            return value.toString();
          },
        },
        axisLine: { lineStyle: { color: getCSSVar('--border-base') || '#e5e6eb' } },
        splitLine: { lineStyle: { color: getCSSVar('--bg-3') || '#e5e6eb', type: 'dashed' } },
      },
      series: chartData.series,
    };
  }, [chartData, t]);

  const pointsChartOption = useMemo(() => {
    const getCSSVar = (name: string) => {
      const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return value || '#1d2129';
    };

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: getCSSVar('--fill-0') || '#ffffff',
        borderColor: getCSSVar('--border-base') || '#e5e6eb',
        textStyle: { color: getCSSVar('--text-primary') || '#1d2129', fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif' },
        formatter: (params: EChartsTooltipParam[]) => {
          if (!params || !params.length) return '';
          const dataIndex = params[0].dataIndex;
          const date = chartData.dates[dataIndex];
          const points = chartData.pointTotals[dataIndex] || 0;
          const tokens = chartData.totals[dataIndex] || 0;
          return `<div style="font-weight:600;margin-bottom:8px">${date}</div><div style="display:flex;justify-content:space-between;gap:12px"><span>${t('settings.modelUsage.points')}</span><span style="font-weight:600">${formatUsagePoints(points) || '0'}</span></div><div style="display:flex;justify-content:space-between;gap:12px;margin-top:4px"><span>${t('settings.modelUsage.totalTokens')}</span><span style="font-weight:600">${tokens.toLocaleString()}</span></div>`;
        },
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '3%',
        top: '20px',
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: chartData.dates.map((d) => dayjs(d).format('MM-DD')),
        axisLabel: { color: getCSSVar('--text-secondary') || '#86909c', fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif' },
        axisLine: { lineStyle: { color: getCSSVar('--border-base') || '#e5e6eb' } },
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          color: getCSSVar('--text-secondary') || '#86909c',
          fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif',
          formatter: (value: number) => formatUsagePoints(value) || '0',
        },
        axisLine: { lineStyle: { color: getCSSVar('--border-base') || '#e5e6eb' } },
        splitLine: { lineStyle: { color: getCSSVar('--bg-3') || '#e5e6eb', type: 'dashed' } },
      },
      series: [
        {
          name: t('settings.modelUsage.points'),
          type: 'bar',
          color: '#ff7d00',
          data: chartData.pointTotals,
          barMaxWidth: 36,
        },
      ],
    };
  }, [chartData, t]);

  const handleDateChange = (dateString: string[], date: Dayjs[]) => {
    if (date && date.length === 2) {
      const maxRange = 30;
      const daysDiff = Math.abs(date[1].diff(date[0], 'day'));
      if (daysDiff > maxRange) {
        Message.warning(t('settings.modelUsage.maxRangeWarning') || '时间范围不能超过30天');
        return;
      }
      setDateRange([date[0].toDate(), date[1].toDate()]);
    }
  };

  return (
    <div className={`p-24px bg-2 rd-16px border border-[var(--color-border-2)] ${className || ''}`}>
      <div className='text-14px font-600 text-t-primary mb-16px'>{t('settings.modelUsage.title') || '模型用量'}</div>

      <div className='mb-16px'>
        <RangePicker value={dateRange} onChange={handleDateChange} format='YYYY-MM-DD' allowClear={false} style={{ width: '100%' }} placeholder={[t('settings.modelUsage.startDate') || '开始日期', t('settings.modelUsage.endDate') || '结束日期']} />
      </div>

      {loading ? (
        <div className='flex justify-center py-60px'>
          <Spin />
        </div>
      ) : !data.length ? (
        <div className='py-60px text-center text-t-tertiary text-14px'>{t('settings.modelUsage.noData') || '暂无模型用量数据'}</div>
      ) : (
        <div className='flex flex-col gap-20px'>
          <div>
            <div className='text-13px font-600 text-t-secondary mb-8px'>{t('settings.modelUsage.pointsTitle')}</div>
            <ReactECharts option={pointsChartOption} style={{ height: '220px' }} opts={{ renderer: 'canvas' }} />
          </div>
          <div className='h-1px bg-border-2' />
          <div>
            <div className='text-13px font-600 text-t-secondary mb-8px'>{t('settings.modelUsage.tokensTitle')}</div>
            <ReactECharts option={modelChartOption} style={{ height: '300px' }} opts={{ renderer: 'canvas' }} />
          </div>
        </div>
      )}
    </div>
  );
};

export default WeeklyModelUsageChart;
