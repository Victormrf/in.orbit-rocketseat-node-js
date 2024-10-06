import { and, desc, eq, gte, lte, sql } from 'drizzle-orm'
import { db } from '../db'
import { goalCompletions, goals } from '../db/schema'
import dayjs from 'dayjs'

export async function getWeekSummary() {
	const lastDayOfWeek = dayjs().endOf('week').toDate()
	const firstDayOfWeek = dayjs().startOf('week').toDate()

	// Metas que preciso completar na semana
	const goalsCreatedUpToWeek = db.$with('goals_created_up_to_week').as(
		db
			.select({
				id: goals.id,
				title: goals.title,
				desiredWeeklyFrequency: goals.desiredWeeklyFrequency,
				createdAt: goals.createdAt,
			})
			.from(goals)
			.where(lte(goals.createdAt, lastDayOfWeek))
	)

	// Metas concluidas na semana
	const goalsCompletedInWeek = db.$with('goals_completed_in_week').as(
		db
			.select({
				id: goalCompletions.id,
				title: goals.title,
				completedAt: goalCompletions.createdAt,
				completedAtDate: sql /*sql*/`
          DATE(${goalCompletions.createdAt})`.as('completedAtDate'),
				// Função DATE do sql remove horário de datas
			})
			.from(goalCompletions)
			.innerJoin(goals, eq(goals.id, goalCompletions.goalId))
			.orderBy(desc(goalCompletions.createdAt))
			.where(
				and(
					gte(goalCompletions.createdAt, firstDayOfWeek),
					lte(goalCompletions.createdAt, lastDayOfWeek)
				)
			)
	)

	const goalsCompletedByWeekDay = db.$with('goals_completed_by_week_day').as(
		db
			.select({
				completedAtDate: goalsCompletedInWeek.completedAtDate,
				completions: sql /*sql*/`
          JSON_AGG(
            JSON_BUILD_OBJECT(
              'id', ${goalsCompletedInWeek.id},
              'title', ${goalsCompletedInWeek.title},
              'completedAt', ${goalsCompletedInWeek.completedAt}
            )
          )
        `.as('completions'),
				// JSON_AGG pega um return do postgres e retorna um array
			})
			.from(goalsCompletedInWeek)
			.groupBy(goalsCompletedInWeek.completedAtDate)
			.orderBy(desc(goalsCompletedInWeek.completedAtDate))
	)

	// Definição do formato da variável GoalsPerDay, em que Record<string, ...> significa um objeto com uma chave do tipo string
	type GoalsPerDay = Record<
		string,
		{
			id: string
			title: string
			completedAt: string
		}[]
	>

	const result = await db
		.with(goalsCreatedUpToWeek, goalsCompletedInWeek, goalsCompletedByWeekDay)
		.select({
			completed: sql /*sql*/`
        (SELECT COUNT(*) FROM ${goalsCompletedInWeek})
      `.mapWith(Number),
			total: sql /*sql*/`
        (SELECT SUM(${goalsCreatedUpToWeek.desiredWeeklyFrequency}) FROM ${goalsCreatedUpToWeek})
      `.mapWith(Number),
			goalsPerDay: sql /*sql*/<GoalsPerDay>`
        JSON_OBJECT_AGG(
          ${goalsCompletedByWeekDay.completedAtDate},
          ${goalsCompletedByWeekDay.completions}
        )
      `,
		})
		.from(goalsCompletedByWeekDay)

	return {
		summary: result[0],
	}
}
