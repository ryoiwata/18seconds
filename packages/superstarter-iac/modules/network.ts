import {
	DescribeSubnetsCommand,
	DescribeVpcsCommand,
	EC2Client
} from "@aws-sdk/client-ec2"
import * as errors from "@superbuilders/errors"
import { logger } from "@/logger"
import type { ModuleContext } from "@/modules/types"

interface NetworkOutput {
	readonly vpcId: string
	readonly subnetIds: string[]
}

async function discoverDefaultNetwork(context: ModuleContext): Promise<NetworkOutput> {
	const client = new EC2Client({ region: context.region })

	const vpcsResult = await errors.try(
		client.send(
			new DescribeVpcsCommand({
				Filters: [{ Name: "isDefault", Values: ["true"] }]
			})
		)
	)
	if (vpcsResult.error) {
		logger.error({ error: vpcsResult.error }, "describe default vpc failed")
		throw errors.wrap(vpcsResult.error, "describe default vpc")
	}

	const vpc = vpcsResult.data.Vpcs?.[0]
	const vpcId = vpc?.VpcId
	if (!vpcId) {
		logger.error("no default vpc found in account")
		throw errors.new(
			"no default vpc found; either run `aws ec2 create-default-vpc` or supply a custom vpc"
		)
	}

	const subnetsResult = await errors.try(
		client.send(
			new DescribeSubnetsCommand({
				Filters: [{ Name: "vpc-id", Values: [vpcId] }]
			})
		)
	)
	if (subnetsResult.error) {
		logger.error({ error: subnetsResult.error, vpcId }, "describe default subnets failed")
		throw errors.wrap(subnetsResult.error, "describe default subnets")
	}

	const subnets = subnetsResult.data.Subnets
	if (!subnets) {
		logger.error({ vpcId }, "describe subnets returned no Subnets array")
		throw errors.new("describe subnets returned no Subnets array")
	}

	const subnetIds: string[] = []
	for (const subnet of subnets) {
		if (subnet.SubnetId) {
			subnetIds.push(subnet.SubnetId)
		}
	}

	if (subnetIds.length < 2) {
		logger.error({ vpcId, subnetCount: subnetIds.length }, "default vpc has fewer than 2 subnets")
		throw errors.new("rds requires a subnet group spanning at least 2 azs; default vpc lacks them")
	}

	logger.info({ vpcId, subnetIds }, "discovered default vpc")
	return { vpcId, subnetIds }
}

export type { NetworkOutput }
export { discoverDefaultNetwork }
