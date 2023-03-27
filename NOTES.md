### AWS Resource Explorer

- the CLI subcommand is `resource-explorer-2`, really?
- `aws resource-explorer-2 list-supported-resource-types | grep ResourceType | wc -l` - only 152 resources.
- `An error occurred (UnauthorizedException) when calling the Search operation: Unauthorized` - wtf?

### AWS Cloud Control API

- https://docs.aws.amazon.com/cloudcontrolapi/latest/userguide/resource-types.html#resource-types-identifier
- https://docs.aws.amazon.com/cloudcontrolapi/latest/userguide/resource-operations-read.html
- https://docs.aws.amazon.com/cloudcontrolapi/latest/userguide/resource-types.html#resource-types-determine-support

```console
 ❯ aws cloudcontrol list-resources --type-name AWS::SQS::Queue                                                     [11:56:37]
{
    "ResourceDescriptions": [
        {
            "Identifier": "https://sqs.us-east-1.amazonaws.com/185706627232/Stack-Queue4A7E3555-CiJRmiNfSLJZ",
            "Properties": "{\"QueueUrl\":\"https://sqs.us-east-1.amazonaws.com/185706627232/Stack-Queue4A7E3555-CiJRmiNfSLJZ\"}"
        },
        {
            "Identifier": "https://sqs.us-east-1.amazonaws.com/185706627232/terraform-20230106124443466000000002",
            "Properties": "{\"QueueUrl\":\"https://sqs.us-east-1.amazonaws.com/185706627232/terraform-20230106124443466000000002\"}"
        }
    ],
    "TypeName": "AWS::SQS::Queue"
}
```

Seems to suggest the Identifier for a queue is its URL, but querying by the URL doesn't work:

```console
❯ aws cloudcontrol get-resource --type-name AWS::SQS::Queue --identifier "https://sqs.us-east-1.amazonaws.com/185706627232/Stack-Queue4A7E3555-CiJRmiNfSLJZ"

Error parsing parameter '--identifier': Unable to retrieve https://sqs.us-east-1.amazonaws.com/185706627232/Stack-Queue4A7E3555-CiJRmiNfSLJZ: received non 200 status code of 404
```

Apparently you need to use the queue name...

```console
❯ aws cloudcontrol get-resource --type-name AWS::SQS::Queue --identifier "Stack-Queue4A7E3555-CiJRmiNfSLJZ"       [11:54:55]
{
    "TypeName": "AWS::SQS::Queue",
    "ResourceDescription": {
        "Identifier": "Stack-Queue4A7E3555-CiJRmiNfSLJZ",
        "Properties": "{\"SqsManagedSseEnabled\":true,\"ReceiveMessageWaitTimeSeconds\":0,\"DelaySeconds\":0,\"MessageRetentionPeriod\":345600,\"MaximumMessageSize\":262144,\"VisibilityTimeout\":30,\"Arn\":\"arn:aws:sqs:us-east-1:185706627232:Stack-Queue4A7E3555-CiJRmiNfSLJZ\",\"QueueName\":\"Stack-Queue4A7E3555-CiJRmiNfSLJZ\",\"QueueUrl\":\"Stack-Queue4A7E3555-CiJRmiNfSLJZ\"}"
    }
}
```

This seems to suggest the name is the identifier...ha?

Also how is "QueueUrl" the same as "QueueName"...? URL should be `https://sqs.us-east-1.amazonaws.com/185706627232/Stack-Queue4A7E3555-CiJRmiNfSLJZ`

- Will the property name returned in "Properties" always match the CloudFormation properties and attributes?
- list-resources should return all resource information like tags so that filtering can be done. otherwise we need to call get-resource only to see its not the resource we want.
- whaaat: https://docs.aws.amazon.com/cloudcontrolapi/latest/userguide/resource-operations-list.html#resource-operations-list-containers
- CloudFormation `Ref` not mapped.

### AWS CloudFormation

- should provide a way to query resource attributes without defining a stack output.

### AWS SDK V3

- `const client = new aws.CloudControlClient()` should be possible since all config is optional.